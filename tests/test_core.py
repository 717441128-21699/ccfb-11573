"""核心逻辑单元测试 + 小规模端到端(6000点位)验证漏采率/重复率为零。

运行: py -m tests.test_core   (在项目根目录)
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from poi_collector.coords import wgs84_to_gcj02, gcj02_to_wgs84
from poi_collector.geo import (haversine_m, point_in_polygon,
                               rect_intersects_polygon)
from poi_collector.dedup import normalize, dedup_key
from poi_collector import mock_data, mock_server
from poi_collector.db import DB
from poi_collector.engine import Engine
from poi_collector.changes import diff_snapshots
from poi_collector.verify import verify


class TestCoords(unittest.TestCase):
    def test_roundtrip(self):
        for lng, lat in [(116.397, 39.908), (116.20, 39.80), (116.50, 40.00)]:
            g = wgs84_to_gcj02(lng, lat)
            w = gcj02_to_wgs84(*g)
            self.assertLess(haversine_m(lng, lat, *w), 1.0)  # 误差 < 1m

    def test_offset_actually_offsets(self):
        g = wgs84_to_gcj02(116.397, 39.908)
        self.assertGreater(haversine_m(116.397, 39.908, *g), 100.0)  # 确实加偏了


class TestGeo(unittest.TestCase):
    def test_point_in_polygon(self):
        poly = [[0, 0], [10, 0], [10, 10], [0, 10]]
        self.assertTrue(point_in_polygon(5, 5, poly))
        self.assertFalse(point_in_polygon(15, 5, poly))

    def test_rect_polygon_intersect(self):
        poly = [[0, 0], [10, 0], [10, 10], [0, 10]]
        self.assertTrue(rect_intersects_polygon(8, 8, 12, 12, poly))   # 部分重叠
        self.assertTrue(rect_intersects_polygon(-1, -1, 1, 1, poly))   # 角在里面
        self.assertTrue(rect_intersects_polygon(4, -5, 6, 5, poly))    # 边穿过
        self.assertFalse(rect_intersects_polygon(20, 20, 30, 30, poly))


class TestDedup(unittest.TestCase):
    def test_normalize(self):
        self.assertEqual(normalize("星巴克（大悦城店）"), normalize("星巴克(大悦城店)"))
        self.assertEqual(normalize("7-ELEVEn "), normalize("7-eleven"))

    def test_key(self):
        self.assertEqual(dedup_key("麦当劳(国贸店)", "建国路 88 号"),
                         dedup_key("麦当劳（国贸店）", "建国路88号"))


class TestFakeEmptyThenOverflow(unittest.TestCase):
    """回归: 假空确认后返回 count>上限 的格子必须继续四分, 不能标 done。"""

    def test_fake_empty_then_over_limit_splits(self):
        tmp = tempfile.mkdtemp()
        db = DB(os.path.join(tmp, "t.db"))
        db.execute(
            "INSERT INTO projects(name, region, created_at) VALUES('t','[]',datetime('now'))")
        db.execute(
            "INSERT INTO grids(project_id,min_lng,min_lat,max_lng,max_lat,depth,status)"
            " VALUES(1,116.0,39.0,116.1,39.1,3,'pending')")
        eng = Engine(db, 1, "http://127.0.0.1:1", log=lambda *a: None)
        # 第一次返回假空, 确认时返回 346 条(超限)
        responses = [
            {"status": "OK", "count": 0, "pois": []},
            {"status": "OK", "count": 346, "pois": []},
        ]
        eng._query = lambda g: responses.pop(0)
        eng._process(db.one("SELECT * FROM grids WHERE id=1"), 1)
        g = db.one("SELECT * FROM grids WHERE id=1")
        self.assertEqual(g["status"], "split", "假空确认出超限后必须四分")
        children = db.query("SELECT * FROM grids WHERE parent_id=1")
        self.assertEqual(len(children), 4)
        db.close()


class TestEndToEnd(unittest.TestCase):
    """小规模端到端: 6000 点位, 全流程跑通, 漏采率/重复率必须为 0。"""

    def test_full_pipeline(self):
        tmp = tempfile.mkdtemp()
        truth_path = os.path.join(tmp, "t1.json")
        truth = mock_data.generate(6000, seed=1)
        mock_data.save(truth, truth_path)

        mock = mock_server.MockMapServer(
            truth_path, port=8199, latency=0, seed=3).start()
        try:
            db = DB(os.path.join(tmp, "t.db"))
            cur = db.execute(
                "INSERT INTO projects(name, region, created_at) VALUES('t',?,datetime('now'))",
                (json.dumps(mock_data.REGION_POLY),))
            pid = cur.lastrowid
            eng = Engine(db, pid, "http://127.0.0.1:8199", log=lambda *a: None)
            eng.init_grids(mock_data.REGION_POLY)
            sid = db.execute(
                "INSERT INTO snapshots(project_id, started_at) VALUES(1, datetime('now'))"
            ).lastrowid
            ok = eng.run(sid)
            self.assertTrue(ok, "存在未完成的格子")
            self.assertGreater(eng.stats["dup_skipped"], 0,
                               "相邻格重叠产生的重复点位应被去重拦截")

            rows = db.query("SELECT * FROM pois WHERE last_seen=?", (sid,))
            result = verify(truth["pois"], rows)
            self.assertEqual(result["missed"], 0, f"漏采: {result['missed_samples'][:3]}")
            self.assertEqual(result["dup_matches"], 0, "存在重复采集")
            self.assertEqual(result["phantom"], 0, "存在幻影点位")

            # 演化 -> 重采 -> 变化追踪
            truth2 = mock_data.evolve(truth, seed=2, n_close=40, n_new=60, n_move=25)
            t2_path = os.path.join(tmp, "t2.json")
            mock_data.save(truth2, t2_path)
            mock.load_data(t2_path)
            eng.reset_for_recollection()
            sid2 = db.execute(
                "INSERT INTO snapshots(project_id, started_at) VALUES(1, datetime('now'))"
            ).lastrowid
            self.assertTrue(eng.run(sid2))
            summary = diff_snapshots(db, pid, sid, sid2)
            self.assertEqual(summary["new"], 60)
            self.assertEqual(summary["closed"], 40)
            self.assertEqual(summary["moved"], 25)
            db.close()
        finally:
            mock.stop()


if __name__ == "__main__":
    unittest.main(verbosity=2)
