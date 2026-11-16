"""变化追踪: 对比相邻两次快照, 标出 新开/关门/搬家。

判定规则:
  新开  —— 本次采到、上次没有的店(按去重键);
  关门  —— 上次有、本次没采到的店;
  搬家  —— 规范店名相同、直线距离 < 500m 的一对"关门+新开", 重新归类为搬家。
"""
from . import db as dbmod
from .geo import haversine_m

MOVED_MAX_M = 500.0


def diff_snapshots(db: dbmod.DB, project_id: int, prev_id: int, curr_id: int):
    prev = db.query(
        "SELECT p.* FROM pois p JOIN snapshot_pois sp ON sp.poi_id=p.id"
        " WHERE p.project_id=? AND sp.snapshot_id=?", (project_id, prev_id))
    curr = db.query(
        "SELECT p.* FROM pois p JOIN snapshot_pois sp ON sp.poi_id=p.id"
        " WHERE p.project_id=? AND sp.snapshot_id=?", (project_id, curr_id))
    prev_by_key = {p["dedup_key"]: p for p in prev}
    curr_by_key = {p["dedup_key"]: p for p in curr}

    new_keys = [k for k in curr_by_key if k not in prev_by_key]
    closed_keys = [k for k in prev_by_key if k not in curr_by_key]

    # 搬家匹配: 同名且距离近的 关门<->新开 配对
    new_by_name = {}
    for k in new_keys:
        p = curr_by_key[k]
        new_by_name.setdefault(p["name_norm"], []).append(p)

    moved_pairs = []
    still_closed = []
    used_new = set()
    for k in closed_keys:
        old = prev_by_key[k]
        cands = [p for p in new_by_name.get(old["name_norm"], [])
                 if p["id"] not in used_new
                 and haversine_m(old["lng"], old["lat"], p["lng"], p["lat"]) < MOVED_MAX_M]
        if cands:
            best = min(cands, key=lambda p: haversine_m(
                old["lng"], old["lat"], p["lng"], p["lat"]))
            used_new.add(best["id"])
            moved_pairs.append((old, best))
        else:
            still_closed.append(old)

    moved_new_ids = {b["id"] for _, b in moved_pairs}
    still_new = [curr_by_key[k] for k in new_keys
                 if curr_by_key[k]["id"] not in moved_new_ids]

    # 落库
    db.execute("DELETE FROM changes WHERE snapshot_id=?", (curr_id,))
    for p in still_new:
        db.execute(
            "INSERT INTO changes(snapshot_id,change_type,poi_id,detail) VALUES(?,?,?,?)",
            (curr_id, "new", p["id"], f"新开: {p['name']} @ {p['address']}"))
    for p in still_closed:
        db.execute(
            "INSERT INTO changes(snapshot_id,change_type,poi_id,detail) VALUES(?,?,?,?)",
            (curr_id, "closed", p["id"], f"关门: {p['name']} @ {p['address']}"))
        db.execute("UPDATE pois SET status='closed' WHERE id=?", (p["id"],))
    for old, new in moved_pairs:
        dist = haversine_m(old["lng"], old["lat"], new["lng"], new["lat"])
        db.execute(
            "INSERT INTO changes(snapshot_id,change_type,poi_id,related_poi_id,detail)"
            " VALUES(?,?,?,?,?)",
            (curr_id, "moved", old["id"], new["id"],
             f"搬家: {old['name']} {old['address']} -> {new['address']} ({dist:.0f}m)"))
        db.execute("UPDATE pois SET status='closed' WHERE id=?", (old["id"],))

    return {
        "new": len(still_new),
        "closed": len(still_closed),
        "moved": len(moved_pairs),
    }
