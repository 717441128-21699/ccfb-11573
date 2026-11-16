"""采集引擎: 网格四分 + 故障重试 + 真空/假空判别 + 断点续采。

状态机(grids.status):
  pending    待采集(初始 / 四分出的子格 / 重采时被重置)
  done       采完且 count<=上限, 结果完整
  done_empty 采完且确认为真空(连续多次空结果才认定, 区别于请求失败)
  split      已四分出子格(非叶子)
  overflow   已切到最小深度仍超限 —— 覆盖分析的重点对象
  failed     重试耗尽仍失败(超时/5xx) —— 下次运行自动续采
"""
import json
import time
import urllib.request
import urllib.error

from . import db as dbmod
from .coords import gcj02_to_wgs84
from .dedup import Deduper, normalize, dedup_key
from .geo import rect_intersects_polygon, polygon_bbox

INITIAL_GRID_N = 4      # 初始把行政区 bbox 切成 4x4
MAX_DEPTH = 8           # 最多四分 8 层(最小格约 20~30m)
PAGE_LIMIT = 200        # 接口单次返回上限


class Engine:
    def __init__(self, db: dbmod.DB, project_id: int, api_base: str,
                 max_depth=MAX_DEPTH, page_limit=PAGE_LIMIT,
                 client_timeout=1.5, max_attempts=6, empty_confirms=2,
                 max_passes=50, log=print):
        self.db = db
        self.project_id = project_id
        self.api_base = api_base.rstrip("/")
        self.max_depth = max_depth
        self.page_limit = page_limit
        self.client_timeout = client_timeout
        self.max_attempts = max_attempts
        self.empty_confirms = empty_confirms   # 空结果需再确认几次才认真空
        self.max_passes = max_passes
        self.log = log
        self.deduper = Deduper(db, project_id)
        self.stats = {"requests": 0, "retries": 0, "ingested": 0, "dup_skipped": 0}

    # ---------- 项目初始化 ----------
    def init_grids(self, region_poly, n=INITIAL_GRID_N):
        """按行政区边界切初始矩形网格: 只保留与多边形相交的格子。"""
        if self.db.one("SELECT id FROM grids WHERE project_id=? LIMIT 1",
                       (self.project_id,)):
            return 0  # 已有网格(断点续采场景), 不重建
        minx, miny, maxx, maxy = polygon_bbox(region_poly)
        dx, dy = (maxx - minx) / n, (maxy - miny) / n
        cnt = 0
        for i in range(n):
            for j in range(n):
                gx0, gy0 = minx + i * dx, miny + j * dy
                gx1, gy1 = gx0 + dx, gy0 + dy
                if not rect_intersects_polygon(gx0, gy0, gx1, gy1, region_poly):
                    continue
                self.db.execute(
                    "INSERT INTO grids(project_id,parent_id,min_lng,min_lat,max_lng,max_lat,"
                    "depth,status,updated_at) VALUES(?,?,?,?,?,?,0,'pending',?)",
                    (self.project_id, None, gx0, gy0, gx1, gy1, dbmod.now()))
                cnt += 1
        return cnt

    # ---------- HTTP ----------
    def _query(self, g):
        url = (f"{self.api_base}/api/search?min_lng={g['min_lng']:.7f}&min_lat={g['min_lat']:.7f}"
               f"&max_lng={g['max_lng']:.7f}&max_lat={g['max_lat']:.7f}")
        self.stats["requests"] += 1
        with urllib.request.urlopen(url, timeout=self.client_timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    # ---------- 主流程 ----------
    def run(self, snapshot_id):
        """跑完所有 pending/failed 格子; 中断后再次调用即断点续采。"""
        for pass_no in range(1, self.max_passes + 1):
            todo = self.db.query(
                "SELECT * FROM grids WHERE project_id=? AND status IN ('pending','failed')",
                (self.project_id,))
            if not todo:
                break
            self.log(f"[engine] 第 {pass_no} 轮: {len(todo)} 个待采格子")
            t0 = time.time()
            for k, g in enumerate(todo, 1):
                self.db.begin()          # 每格一个事务: 批量入库只提交一次
                try:
                    self._process(g, snapshot_id)
                finally:
                    self.db.commit()
                if k % 200 == 0:
                    self.log(f"[engine]   进度 {k}/{len(todo)} "
                             f"({time.time()-t0:.1f}s, 已入库 {self.stats['ingested']})")
        left = self.db.one(
            "SELECT COUNT(*) c FROM grids WHERE project_id=? AND status IN ('pending','failed')",
            (self.project_id,))["c"]
        return left == 0

    def reset_for_recollection(self):
        """月度重采: 所有叶子格重置为 pending, 复用已切好的网格结构。"""
        self.db.execute(
            "UPDATE grids SET status='pending', attempts=0 WHERE project_id=? AND status IN"
            " ('done','done_empty','overflow','failed') AND id NOT IN"
            " (SELECT DISTINCT parent_id FROM grids WHERE parent_id IS NOT NULL)",
            (self.project_id,))

    # ---------- 单格处理 ----------
    def _process(self, g, snapshot_id):
        gid = g["id"]
        data = None
        attempts = 0
        for attempt in range(self.max_attempts):
            attempts += 1
            try:
                data = self._query(g)
                if data.get("status") == "OK":
                    break
            except Exception:
                data = None
            self.stats["retries"] += 1
            time.sleep(0.05 * (attempt + 1))  # 退避
        else:
            self._mark(gid, "failed", attempts=g["attempts"] + attempts,
                     note="重试耗尽: 超时或5xx, 留待续采")
            return

        # 空结果: 真空还是假空? 再确认 empty_confirms 次, 全部为空才认定
        if data["count"] == 0:
            for _ in range(self.empty_confirms):
                try:
                    again = self._query(g)
                    if again.get("status") == "OK" and again.get("count", 0) > 0:
                        data = again   # 假空, 用确认到的响应继续走正常流程
                        break
                except Exception:
                    self.stats["retries"] += 1
            else:
                self._mark(gid, "done_empty", 0, g["attempts"] + attempts,
                           note=f"经{self.empty_confirms}次确认为真空")
                return

        # 到这里 data 是可信响应; 超限判断必须放在假空确认之后,
        # 否则"假空->确认出超限"的格子会被错误地当成采完
        count = data["count"]
        if count > self.page_limit:
            if g["depth"] >= self.max_depth:
                # 切到最小仍超限: 尽力入库本页, 标记 overflow 供覆盖分析
                self._ingest(data["pois"], snapshot_id)
                self._mark(gid, "overflow", count, g["attempts"] + attempts,
                           note=f"最小深度仍超限(count={count}), 结果不完整")
            else:
                self._split(g)
                self._mark(gid, "split", count, g["attempts"] + attempts)
            return

        self._ingest(data["pois"], snapshot_id)
        self._mark(gid, "done", count, g["attempts"] + attempts)

    def _split(self, g):
        mid_lng = (g["min_lng"] + g["max_lng"]) / 2
        mid_lat = (g["min_lat"] + g["max_lat"]) / 2
        for x0, x1 in ((g["min_lng"], mid_lng), (mid_lng, g["max_lng"])):
            for y0, y1 in ((g["min_lat"], mid_lat), (mid_lat, g["max_lat"])):
                self.db.execute(
                    "INSERT INTO grids(project_id,parent_id,min_lng,min_lat,max_lng,max_lat,"
                    "depth,status,updated_at) VALUES(?,?,?,?,?,?,?,'pending',?)",
                    (self.project_id, g["id"], x0, y0, x1, y1,
                     g["depth"] + 1, dbmod.now()))

    def _mark(self, gid, status, result_count=0, attempts=0, note=""):
        self.db.execute(
            "UPDATE grids SET status=?, result_count=?, attempts=?, note=?, updated_at=?"
            " WHERE id=?",
            (status, result_count, attempts, note, dbmod.now(), gid))

    # ---------- 入库(转 WGS84 + 去重) ----------
    def _ingest(self, pois, snapshot_id):
        for p in pois:
            lng, lat = gcj02_to_wgs84(p["lng"], p["lat"])  # 加偏 -> WGS84
            existing_id, key = self.deduper.find_existing(
                p["name"], p["address"], lng, lat)
            if existing_id is not None:
                self.db.execute(
                    "UPDATE pois SET last_seen=? WHERE id=?", (snapshot_id, existing_id))
                self.db.execute(
                    "INSERT OR IGNORE INTO snapshot_pois(snapshot_id, poi_id) VALUES(?,?)",
                    (snapshot_id, existing_id))
                self.stats["dup_skipped"] += 1
                continue
            cur = self.db.execute(
                "INSERT INTO pois(project_id,dedup_key,name,name_norm,address,addr_norm,"
                "brand,category,lng,lat,status,first_seen,last_seen)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,'active',?,?)",
                (self.project_id, key, p["name"], normalize(p["name"]),
                 p["address"], normalize(p["address"]), p.get("brand", ""),
                 p.get("category", ""), lng, lat, snapshot_id, snapshot_id))
            self.db.execute(
                "INSERT OR IGNORE INTO snapshot_pois(snapshot_id, poi_id) VALUES(?,?)",
                (snapshot_id, cur.lastrowid))
            self.stats["ingested"] += 1
