"""端到端演示: 生成真值 -> 起模拟接口 -> 采集 -> 验证 -> 演化 -> 重采 -> 变化追踪。

用法:
  py run_demo.py              # 完整跑一遍(10万点位)
  py run_demo.py --serve      # 跑完后启动后台 http://127.0.0.1:8000
  py run_demo.py --fresh      # 清空数据库重来
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from poi_collector import mock_data, mock_server
from poi_collector.db import DB, now
from poi_collector.engine import Engine
from poi_collector.changes import diff_snapshots
from poi_collector.coverage import coverage_report
from poi_collector.verify import verify

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
EPOCH1 = os.path.join(DATA_DIR, "truth_epoch1.json")
EPOCH2 = os.path.join(DATA_DIR, "truth_epoch2.json")
DB_PATH = os.path.join(DATA_DIR, "collector.db")
MOCK_PORT = 8123


def ensure_truth():
    if not os.path.exists(EPOCH1):
        print("[data] 生成 10 万点位真值 ...")
        t0 = time.time()
        truth = mock_data.generate(100000)
        mock_data.save(truth, EPOCH1)
        print(f"[data] 完成 {len(truth['pois'])} 条, {time.time()-t0:.1f}s")
    if not os.path.exists(EPOCH2):
        print("[data] 演化出'一个月后'的真值(关门/新开/搬家) ...")
        truth2 = mock_data.evolve(mock_data.load(EPOCH1))
        mock_data.save(truth2, EPOCH2)


def new_snapshot(db, project_id):
    cur = db.execute(
        "INSERT INTO snapshots(project_id, started_at) VALUES(?,?)",
        (project_id, now()))
    return cur.lastrowid


def finish_snapshot(db, sid):
    cnt = db.one("SELECT COUNT(*) c FROM snapshot_pois WHERE snapshot_id=?", (sid,))["c"]
    db.execute("UPDATE snapshots SET finished_at=?, poi_count=? WHERE id=?",
               (now(), cnt, sid))
    return cnt


def run_collection(db, project_id, tag):
    sid = new_snapshot(db, project_id)
    engine = Engine(db, project_id, f"http://127.0.0.1:{MOCK_PORT}")
    t0 = time.time()
    ok = engine.run(sid)
    cnt = finish_snapshot(db, sid)
    print(f"[{tag}] 快照#{sid} 采集{'完成' if ok else '未全部完成'}: "
          f"{cnt} 个点位, 请求 {engine.stats['requests']} 次, "
          f"重试 {engine.stats['retries']} 次, 去重拦截 {engine.stats['dup_skipped']} 条, "
          f"耗时 {time.time()-t0:.1f}s")
    return sid, engine


def run_verify(db, sid, epoch_path, tag):
    truth = mock_data.load(epoch_path)
    rows = db.query("SELECT p.* FROM pois p JOIN snapshot_pois sp ON sp.poi_id=p.id"
                    " WHERE sp.snapshot_id=?", (sid,))
    result = verify(truth["pois"], rows)
    print(f"[{tag}] 验证: 真值 {result['truth_total']} / 采集 {result['collected_total']} | "
          f"漏采 {result['missed']} ({result['miss_rate']*100:.4f}%) | "
          f"重复 {result['dup_matches']} ({result['dup_rate']*100:.4f}%) | "
          f"幻影 {result['phantom']}")
    if result["missed_samples"]:
        print(f"[{tag}] 漏采样例: {result['missed_samples'][:3]}")
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--serve", action="store_true", help="结束后启动后台")
    ap.add_argument("--fresh", action="store_true", help="清空数据库重来")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()

    os.makedirs(DATA_DIR, exist_ok=True)
    if args.fresh and os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        os.remove(DB_PATH + "-wal") if os.path.exists(DB_PATH + "-wal") else None
        os.remove(DB_PATH + "-shm") if os.path.exists(DB_PATH + "-shm") else None

    ensure_truth()

    mock = mock_server.MockMapServer(EPOCH1, port=MOCK_PORT).start()
    print(f"[mock] 模拟地图接口: http://127.0.0.1:{MOCK_PORT}/api/search "
          f"(上限200条/次, 坐标GCJ-02加偏, 故障注入已开)")
    try:
        db = DB(DB_PATH)
        proj = db.one("SELECT * FROM projects WHERE name='demo' ORDER BY id DESC LIMIT 1")
        if not proj:
            cur = db.execute(
                "INSERT INTO projects(name, region, created_at) VALUES(?,?,?)",
                ("demo", json.dumps(mock_data.REGION_POLY), now()))
            project_id = cur.lastrowid
        else:
            project_id = proj["id"]

        engine0 = Engine(db, project_id, f"http://127.0.0.1:{MOCK_PORT}")
        n = engine0.init_grids(mock_data.REGION_POLY)
        if n:
            print(f"[grid] 初始网格 {n} 个(按行政区多边形裁剪)")

        # ---- 第一次采集 ----
        sid1, eng1 = run_collection(db, project_id, "首轮")
        v1 = run_verify(db, sid1, EPOCH1, "首轮")

        # ---- 断点续采演示: 直接再跑一遍, 应该没有待采格子 ----
        left = db.one("SELECT COUNT(*) c FROM grids WHERE project_id=? AND status IN"
                      " ('pending','failed')", (project_id,))["c"]
        print(f"[resume] 中断续采检查: 剩余待采格子 {left} 个(0 = 不会从头再来)")

        # ---- 一个月后: 平台数据演化, 重采 ----
        import urllib.request
        req = urllib.request.Request(
            f"http://127.0.0.1:{MOCK_PORT}/admin/reload?path={EPOCH2}", method="POST")
        urllib.request.urlopen(req).read()
        print("[mock] 平台数据已切换到一个月后(有门店新开/关门/搬家)")

        eng2 = Engine(db, project_id, f"http://127.0.0.1:{MOCK_PORT}")
        eng2.reset_for_recollection()
        sid2, eng2 = run_collection(db, project_id, "重采")
        v2 = run_verify(db, sid2, EPOCH2, "重采")

        summary = diff_snapshots(db, project_id, sid1, sid2)
        print(f"[变化] 新开 {summary['new']} / 关门 {summary['closed']} / 搬家 {summary['moved']}")

        # ---- 覆盖分析 ----
        cov = coverage_report(db, project_id, mock_data.REGION_POLY)
        print(f"[覆盖] 叶子格 {cov['leaf_grids']} 个, 状态分布 {cov['by_status']}, "
              f"最小深度仍超限 {len(cov['overflow_grids'])} 个, "
              f"最大深度 {cov['max_depth_reached']}")

        # ---- 统计落库(供后台展示) ----
        stats = {"requests": eng1.stats["requests"] + eng2.stats["requests"],
                 "retries": eng1.stats["retries"] + eng2.stats["retries"],
                 "dup_skipped": eng1.stats["dup_skipped"] + eng2.stats["dup_skipped"]}
        db.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('engine_stats',?)",
                   (json.dumps(stats),))
        db.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('verify',?)",
                   (json.dumps(v2),))

        print(f"[mock] 接口侧统计: {mock.stats}")

        if args.serve:
            from poi_collector.webapp import serve
            serve(DB_PATH, args.port)
        db.close()
    finally:
        if not args.serve:
            mock.stop()


if __name__ == "__main__":
    main()
