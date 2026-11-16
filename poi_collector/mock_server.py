"""模拟地图开放平台搜索接口(纯本地 HTTP 服务)。

行为对齐真实平台:
  * GET /api/search?min_lng&min_lat&max_lng&max_lat
    返回矩形范围内点位, 单次最多 page_limit 条(默认 200),
    count 字段报告格内真实总数, 超限截断 -> 客户端应继续四分。
  * 返回坐标为 GCJ-02 加偏坐标。
  * 故障注入(带随机种子, 可复现):
      - 3% 请求"超时"(服务端睡 8s, 客户端 2s 超时)
      - 1% 返回 HTTP 500
      - 0.5% 返回 200 但空结果(假空, 用来考验"真空/假空"判别)
  * POST /admin/reload?path=...  切换数据文件(模拟下个月的平台数据)。
"""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from .coords import wgs84_to_gcj02
from . import mock_data

CELL = 0.01  # 空间索引格大小(度)
MARGIN = 0.0005  # 查询外扩余量(约50m): 模拟真实平台按中心+半径搜索,
                 # 边缘点位会在相邻格的请求里重复返回 -> 考验客户端去重


class MockMapServer:
    def __init__(self, data_path, host="127.0.0.1", port=8123,
                 seed=7, latency=0.001, page_limit=200,
                 timeout_prob=0.03, error_prob=0.01, empty_prob=0.005):
        self.host, self.port = host, port
        self.latency = latency
        self.page_limit = page_limit
        self.timeout_prob = timeout_prob
        self.error_prob = error_prob
        self.empty_prob = empty_prob
        self._rng_lock = threading.Lock()
        self._rng = __import__("random").Random(seed)
        self._data_lock = threading.Lock()
        self.stats = {"requests": 0, "timeouts": 0, "errors": 0, "fake_empty": 0}
        self.load_data(data_path)
        self._httpd = None
        self._thread = None

    def load_data(self, data_path):
        truth = mock_data.load(data_path)
        pois = truth["pois"]
        index = {}
        for p in pois:
            key = (int(p["lng"] / CELL), int(p["lat"] / CELL))
            index.setdefault(key, []).append(p)
        with self._data_lock:
            self._pois = pois
            self._index = index

    # ---- 查询 ----
    def search(self, min_lng, min_lat, max_lng, max_lat):
        """返回 (格内点位, 余量点位)。

        count 以严格格内为准(客户端据此决定是否继续四分);
        余量点位模拟真实平台"附近"语义, 让边缘点位在相邻格重复出现。
        """
        m_lng0, m_lat0 = min_lng - MARGIN, min_lat - MARGIN
        m_lng1, m_lat1 = max_lng + MARGIN, max_lat + MARGIN
        with self._data_lock:
            index = self._index
            inside, margin = [], []
            ix0, ix1 = int(m_lng0 / CELL), int(m_lng1 / CELL)
            iy0, iy1 = int(m_lat0 / CELL), int(m_lat1 / CELL)
            for ix in range(ix0, ix1 + 1):
                for iy in range(iy0, iy1 + 1):
                    for p in index.get((ix, iy), ()):
                        if not (m_lng0 <= p["lng"] <= m_lng1 and m_lat0 <= p["lat"] <= m_lat1):
                            continue
                        if min_lng <= p["lng"] <= max_lng and min_lat <= p["lat"] <= max_lat:
                            inside.append(p)
                        else:
                            margin.append(p)
        inside.sort(key=lambda p: p["id"])
        margin.sort(key=lambda p: p["id"])
        return inside, margin

    # ---- HTTP ----
    def _make_handler(self):
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send_json(self, obj, code=200):
                body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                u = urlparse(self.path)
                if u.path == "/api/search":
                    self._search(u)
                elif u.path == "/admin/stats":
                    self._send_json(server.stats)
                else:
                    self.send_error(404)

            def do_POST(self):
                u = urlparse(self.path)
                if u.path == "/admin/reload":
                    qs = parse_qs(u.query)
                    server.load_data(qs["path"][0])
                    self._send_json({"ok": True})
                else:
                    self.send_error(404)

            def _search(self, u):
                with server._rng_lock:
                    r = server._rng.random()
                server.stats["requests"] += 1
                if r < server.timeout_prob:          # 模拟超时: 不响应
                    server.stats["timeouts"] += 1
                    time.sleep(8)
                    return
                if r < server.timeout_prob + server.error_prob:
                    server.stats["errors"] += 1
                    self._send_json({"status": "SERVER_ERROR"}, code=500)
                    return
                qs = parse_qs(u.query)
                min_lng, min_lat = float(qs["min_lng"][0]), float(qs["min_lat"][0])
                max_lng, max_lat = float(qs["max_lng"][0]), float(qs["max_lat"][0])
                if server.latency:
                    time.sleep(server.latency)
                if r < server.timeout_prob + server.error_prob + server.empty_prob:
                    server.stats["fake_empty"] += 1
                    self._send_json({"status": "OK", "count": 0, "pois": []})
                    return
                hits, margin = server.search(min_lng, min_lat, max_lng, max_lat)
                pois = []
                # 格内点位优先, 保证 "count<=上限 -> 格内点位必然全在本页"
                for p in (hits + margin)[:server.page_limit]:
                    glng, glat = wgs84_to_gcj02(p["lng"], p["lat"])  # 加偏
                    pois.append({
                        "name": p["name"], "address": p["address"],
                        "brand": p["brand"], "category": p["category"],
                        "lng": round(glng, 7), "lat": round(glat, 7),
                    })
                self._send_json({"status": "OK", "count": len(hits), "pois": pois})

        return Handler

    def start(self):
        self._httpd = ThreadingHTTPServer((self.host, self.port), self._make_handler())
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()
        return self

    def stop(self):
        if self._httpd:
            self._httpd.shutdown()
            self._httpd.server_close()


def main():
    import argparse
    ap = argparse.ArgumentParser(description="模拟地图搜索接口")
    ap.add_argument("--data", required=True, help="真值数据文件路径")
    ap.add_argument("--port", type=int, default=8123)
    ap.add_argument("--latency", type=float, default=0.001)
    args = ap.parse_args()
    srv = MockMapServer(args.data, port=args.port, latency=args.latency).start()
    print(f"mock map api on http://127.0.0.1:{args.port}/api/search")
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        srv.stop()


if __name__ == "__main__":
    main()
