"""本地后台: 项目总览 / 网格覆盖地图 / 点位库 / 变化追踪。

纯标准库 HTTP 服务, 单页面前端(canvas 绘制, 无外部依赖)。
启动:  python -m poi_collector.webapp --db data/collector.db --port 8000
"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from .db import DB
from .coverage import coverage_report

PAGE = r"""<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>点位采集系统后台</title>
<style>
  body{font-family:"Microsoft YaHei",sans-serif;margin:0;background:#f4f6f8;color:#222}
  header{background:#1f2d3d;color:#fff;padding:10px 20px;font-size:18px}
  nav{display:flex;gap:4px;background:#2f4358;padding:0 16px}
  nav button{background:none;border:none;color:#cfd8e3;padding:12px 18px;cursor:pointer;font-size:14px}
  nav button.active{color:#fff;border-bottom:3px solid #4fc3f7}
  main{padding:16px 20px}
  .cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px}
  .card{background:#fff;border-radius:8px;padding:12px 18px;box-shadow:0 1px 3px rgba(0,0,0,.12);min-width:130px}
  .card .num{font-size:24px;font-weight:700;margin-top:4px}
  table{border-collapse:collapse;width:100%;background:#fff;font-size:13px}
  th,td{border:1px solid #e3e8ee;padding:6px 8px;text-align:left}
  th{background:#eef2f6}
  canvas{background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.12)}
  .legend span{display:inline-block;margin-right:14px;font-size:13px}
  .legend i{display:inline-block;width:12px;height:12px;margin-right:4px;vertical-align:middle}
  .toolbar{margin:10px 0;font-size:14px}
  .tag{padding:2px 8px;border-radius:10px;color:#fff;font-size:12px}
  .new{background:#2196f3}.closed{background:#f44336}.moved{background:#ff9800}
</style>
</head>
<body>
<header>门店点位采集系统 · 本地模拟后台</header>
<nav>
  <button data-tab="overview" class="active">项目总览</button>
  <button data-tab="map">网格覆盖地图</button>
  <button data-tab="pois">点位库</button>
  <button data-tab="changes">变化追踪</button>
</nav>
<main>
  <section id="overview">
    <div class="cards" id="statCards"></div>
    <h3>覆盖分析</h3>
    <div id="covBox"></div>
  </section>
  <section id="map" hidden>
    <div class="toolbar">
      <label><input type="checkbox" id="showPois" checked> 点位</label>
      <label><input type="checkbox" id="showGrids" checked> 网格</label>
      <label><input type="checkbox" id="showChanges"> 变化(新开/关门/搬家)</label>
    </div>
    <div class="legend">
      <span><i style="background:#66bb6a"></i>采完</span>
      <span><i style="background:#bdbdbd"></i>确认真空</span>
      <span><i style="background:#ff9800"></i>最小深度仍超限</span>
      <span><i style="background:#f44336"></i>失败待续采</span>
      <span><i style="background:#90caf9"></i>待采</span>
      <span><i style="background:#2196f3"></i>新开</span>
      <span><i style="background:#e53935"></i>关门</span>
      <span><i style="background:#ffb300"></i>搬家</span>
    </div>
    <canvas id="cv" width="1100" height="760"></canvas>
  </section>
  <section id="pois" hidden>
    <div class="toolbar">
      <input id="kw" placeholder="按名称/地址搜索" size="30">
      <span id="poiCount"></span>
    </div>
    <table><thead><tr><th>名称</th><th>地址</th><th>品牌</th><th>类别</th>
      <th>经度(WGS84)</th><th>纬度</th><th>状态</th></tr></thead>
      <tbody id="poiBody"></tbody></table>
  </section>
  <section id="changes" hidden>
    <div class="cards" id="chgCards"></div>
    <table><thead><tr><th>类型</th><th>详情</th></tr></thead>
      <tbody id="chgBody"></tbody></table>
  </section>
</main>
<script>
let DATA = {};
async function load(){
  const [ov, grids, pois, changes] = await Promise.all([
    fetch('/api/overview').then(r=>r.json()),
    fetch('/api/grids').then(r=>r.json()),
    fetch('/api/pois').then(r=>r.json()),
    fetch('/api/changes').then(r=>r.json()),
  ]);
  DATA = {ov, grids, pois, changes};
  renderOverview(); renderMap(); renderPois(DATA.pois.pois); renderChanges();
}
document.querySelectorAll('nav button').forEach(b=>{
  b.onclick=()=>{
    document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    document.querySelectorAll('main section').forEach(s=>s.hidden=true);
    document.getElementById(b.dataset.tab).hidden=false;
    if(b.dataset.tab==='map') renderMap();
  };
});
function card(t,n,color){return `<div class="card"><div>${t}</div><div class="num" style="color:${color||'#1f2d3d'}">${n}</div></div>`}
function renderOverview(){
  const s = DATA.ov.stats, c = DATA.ov.coverage;
  document.getElementById('statCards').innerHTML =
    card('点位总数', s.pois) + card('叶子网格', c.leaf_grids) +
    card('采完', c.by_status.done||0, '#43a047') +
    card('确认真空', c.by_status.done_empty||0, '#757575') +
    card('超限未解', c.overflow_grids.length, '#fb8c00') +
    card('失败待续采', c.failed_grids, '#e53935') +
    card('接口请求', s.requests) + card('重试', s.retries) +
    card('去重拦截', s.dup_skipped) +
    card('漏采率', (s.verify? (s.verify.miss_rate*100).toFixed(3)+'%':'-'), '#e53935') +
    card('重复率', (s.verify? (s.verify.dup_rate*100).toFixed(3)+'%':'-'), '#e53935');
  let h = `<p>覆盖率(已采完格子面积/行政区外接矩形): ${(c.coverage_ratio*100).toFixed(1)}%
    &nbsp;|&nbsp; 实际切到的最大深度: ${c.max_depth_reached}
    &nbsp;|&nbsp; 叶子格深度分布: ${JSON.stringify(c.leaf_depth_histogram)}</p>`;
  if(c.overflow_grids.length){
    h += '<p style="color:#e65100">以下格子已切到最小深度仍超过接口上限, 需要更细策略:</p><ul>';
    for(const g of c.overflow_grids)
      h += `<li>格#${g.id} 深度${g.depth} 数量${g.count} [${g.bbox.map(v=>v.toFixed(4)).join(', ')}]</li>`;
    h += '</ul>';
  } else h += '<p style="color:#2e7d32">没有"切到最小仍超限"的格子, 区域已拿全。</p>';
  document.getElementById('covBox').innerHTML = h;
}
const GRID_COLOR = {done:'#66bb6a', done_empty:'#bdbdbd', overflow:'#ff9800',
                    failed:'#f44336', pending:'#90caf9', split:'#e0e0e0'};
function project(lng,lat,bbox,W,H){
  const [x0,y0,x1,y1]=bbox, pad=20;
  return [pad+(lng-x0)/(x1-x0)*(W-2*pad), H-pad-(lat-y0)/(y1-y0)*(H-2*pad)];
}
function renderMap(){
  const cv=document.getElementById('cv'), ctx=cv.getContext('2d');
  const W=cv.width,H=cv.height; ctx.clearRect(0,0,W,H);
  const region=DATA.ov.region;
  const xs=region.map(p=>p[0]), ys=region.map(p=>p[1]);
  const bbox=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
  // 行政区
  ctx.beginPath();
  region.forEach((p,i)=>{const [x,y]=project(p[0],p[1],bbox,W,H); i?ctx.lineTo(x,y):ctx.moveTo(x,y)});
  ctx.closePath(); ctx.fillStyle='#f7fafc'; ctx.fill(); ctx.strokeStyle='#37474f'; ctx.lineWidth=2; ctx.stroke();
  // 网格
  if(document.getElementById('showGrids').checked){
    for(const g of DATA.grids.grids){
      const [x0,y1]=project(g.min_lng,g.min_lat,bbox,W,H);
      const [x1,y0]=project(g.max_lng,g.max_lat,bbox,W,H);
      ctx.fillStyle=GRID_COLOR[g.status]||'#eee';
      ctx.globalAlpha=0.45; ctx.fillRect(x0,y0,x1-x0,y1-y0); ctx.globalAlpha=1;
      ctx.strokeStyle='#90a4ae'; ctx.lineWidth=0.4; ctx.strokeRect(x0,y0,x1-x0,y1-y0);
    }
  }
  // 点位
  if(document.getElementById('showPois').checked){
    ctx.fillStyle='rgba(38,50,56,0.55)';
    for(const p of DATA.pois.pois){
      const [x,y]=project(p.lng,p.lat,bbox,W,H);
      ctx.fillRect(x-1,y-1,2,2);
    }
  }
  // 变化
  if(document.getElementById('showChanges').checked){
    const cmap={new:'#2196f3',closed:'#e53935',moved:'#ffb300'};
    for(const ch of DATA.changes.changes){
      if(!ch.lng) continue;
      const [x,y]=project(ch.lng,ch.lat,bbox,W,H);
      ctx.beginPath(); ctx.arc(x,y,4,0,7);
      ctx.fillStyle=cmap[ch.change_type]; ctx.fill();
      ctx.strokeStyle='#fff'; ctx.stroke();
    }
  }
}
function renderPois(list){
  document.getElementById('poiCount').textContent=`共 ${DATA.pois.total} 条, 显示前 ${list.length} 条`;
  document.getElementById('poiBody').innerHTML = list.map(p=>
    `<tr><td>${p.name}</td><td>${p.address}</td><td>${p.brand}</td><td>${p.category}</td>
     <td>${p.lng.toFixed(6)}</td><td>${p.lat.toFixed(6)}</td><td>${p.status}</td></tr>`).join('');
}
document.getElementById('kw').oninput=e=>{
  const k=e.target.value.trim();
  fetch('/api/pois?kw='+encodeURIComponent(k)).then(r=>r.json()).then(d=>{
    DATA.pois.total=d.total; renderPois(d.pois);
  });
};
function renderChanges(){
  const s=DATA.changes.summary;
  document.getElementById('chgCards').innerHTML =
    card('新开', s.new||0,'#2196f3')+card('关门', s.closed||0,'#f44336')+card('搬家', s.moved||0,'#ff9800');
  document.getElementById('chgBody').innerHTML = DATA.changes.changes.map(c=>
    `<tr><td><span class="tag ${c.change_type}">${{new:'新开',closed:'关门',moved:'搬家'}[c.change_type]}</span></td>
     <td>${c.detail}</td></tr>`).join('');
}
['showPois','showGrids','showChanges'].forEach(id=>document.getElementById(id).onchange=renderMap);
load();
</script>
</body>
</html>
"""


def make_handler(db_path, stats_provider):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _json(self, obj):
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            u = urlparse(self.path)
            qs = parse_qs(u.query)
            db = DB(db_path)
            try:
                if u.path == "/":
                    body = PAGE.encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                elif u.path == "/api/overview":
                    proj = db.one("SELECT * FROM projects ORDER BY id DESC LIMIT 1")
                    region = json.loads(proj["region"])
                    cov = coverage_report(db, proj["id"], region)
                    stats = stats_provider(db, proj["id"])
                    self._json({"project": {"id": proj["id"], "name": proj["name"]},
                                "region": region, "coverage": cov, "stats": stats})
                elif u.path == "/api/grids":
                    proj = db.one("SELECT id FROM projects ORDER BY id DESC LIMIT 1")
                    rows = db.query(
                        "SELECT * FROM grids WHERE project_id=? AND id NOT IN"
                        " (SELECT DISTINCT parent_id FROM grids WHERE parent_id IS NOT NULL)",
                        (proj["id"],))
                    self._json({"grids": [dict(r) for r in rows]})
                elif u.path == "/api/pois":
                    proj = db.one("SELECT id FROM projects ORDER BY id DESC LIMIT 1")
                    kw = qs.get("kw", [""])[0].strip()
                    if kw:
                        like = f"%{kw}%"
                        total = db.one(
                            "SELECT COUNT(*) c FROM pois WHERE project_id=? AND"
                            " (name LIKE ? OR address LIKE ?)",
                            (proj["id"], like, like))["c"]
                        rows = db.query(
                            "SELECT * FROM pois WHERE project_id=? AND (name LIKE ? OR address LIKE ?)"
                            " ORDER BY id LIMIT 500", (proj["id"], like, like))
                    else:
                        total = db.one("SELECT COUNT(*) c FROM pois WHERE project_id=?",
                                       (proj["id"],))["c"]
                        rows = db.query("SELECT * FROM pois WHERE project_id=? ORDER BY id LIMIT 500",
                                        (proj["id"],))
                    self._json({"total": total, "pois": [dict(r) for r in rows]})
                elif u.path == "/api/changes":
                    rows = db.query(
                        "SELECT c.*, p.lng, p.lat FROM changes c"
                        " LEFT JOIN pois p ON p.id=c.poi_id"
                        " ORDER BY c.id DESC LIMIT 2000")
                    summary = {}
                    for r in db.query(
                            "SELECT change_type, COUNT(*) c FROM changes GROUP BY change_type"):
                        summary[r["change_type"]] = r["c"]
                    self._json({"summary": summary, "changes": [dict(r) for r in rows]})
                else:
                    self.send_error(404)
            finally:
                db.close()
    return Handler


def default_stats(db, project_id):
    row = db.one("SELECT COUNT(*) c FROM pois WHERE project_id=?", (project_id,))
    stats = {"pois": row["c"], "requests": "-", "retries": "-", "dup_skipped": "-",
             "verify": None}
    v = db.one("SELECT value FROM meta WHERE key='verify'") if db.one(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='meta'") else None
    if v:
        stats["verify"] = json.loads(v["value"])
    e = db.one("SELECT value FROM meta WHERE key='engine_stats'") if db.one(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='meta'") else None
    if e:
        stats.update(json.loads(e["value"]))
    return stats


def serve(db_path, port=8000, stats_provider=None):
    handler = make_handler(db_path, stats_provider or default_stats)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"后台已启动: http://127.0.0.1:{port}")
    httpd.serve_forever()


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    serve(args.db, args.port)
