"""覆盖分析: 网格状态统计、切到最小仍超限的格子清单、覆盖率。"""
from .geo import polygon_bbox


def coverage_report(db, project_id: int, region_poly):
    rows = db.query(
        "SELECT status, COUNT(*) c FROM grids WHERE project_id=? GROUP BY status",
        (project_id,))
    by_status = {r["status"]: r["c"] for r in rows}

    leaves = db.query(
        "SELECT * FROM grids WHERE project_id=? AND id NOT IN"
        " (SELECT DISTINCT parent_id FROM grids WHERE parent_id IS NOT NULL)",
        (project_id,))

    overflow = [g for g in leaves if g["status"] == "overflow"]
    failed = [g for g in leaves if g["status"] == "failed"]

    minx, miny, maxx, maxy = polygon_bbox(region_poly)
    region_area = (maxx - minx) * (maxy - miny)
    covered = sum((g["max_lng"] - g["min_lng"]) * (g["max_lat"] - g["min_lat"])
                  for g in leaves if g["status"] in ("done", "done_empty"))

    depth_stat = {}
    for g in leaves:
        depth_stat[g["depth"]] = depth_stat.get(g["depth"], 0) + 1

    return {
        "by_status": by_status,
        "leaf_grids": len(leaves),
        "overflow_grids": [
            {"id": g["id"], "bbox": [g["min_lng"], g["min_lat"], g["max_lng"], g["max_lat"]],
             "depth": g["depth"], "count": g["result_count"], "note": g["note"]}
            for g in overflow],
        "failed_grids": len(failed),
        "coverage_ratio": covered / region_area if region_area else 0,
        "leaf_depth_histogram": dict(sorted(depth_stat.items())),
        "max_depth_reached": max(depth_stat) if depth_stat else 0,
    }
