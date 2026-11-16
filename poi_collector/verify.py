"""真值比对: 漏采率 / 重复率。

匹配规则: 同名(规范化)且距离 < MATCH_M 即视为同一家店。
真值店名全局唯一, 因此按 name_norm 建索引, 每个真值点位的候选通常只有 1 条,
比对是 O(n) 而不是按空间格子暴力扫(商圈核心一个 200m 格子里有几千个点)。

  漏采  —— 同名候选都不存在或都太远的真值;
  重复  —— 采集库里同名且距离 < DUP_M 的成对点位(去重失败的直接证据);
  幻影  —— 配不到任何真值的采集点。
"""
from .dedup import normalize
from .geo import haversine_m

MATCH_M = 50.0
DUP_M = 25.0


def verify(truth_pois, collected_rows):
    """collected_rows: sqlite Row 列表(某次快照采到的点位)。"""
    by_name = {}
    for r in collected_rows:
        by_name.setdefault(r["name_norm"], []).append(r)

    matched_c = set()
    missed = []
    for t in truth_pois:
        nn = normalize(t["name"])
        best_id, best_d = None, MATCH_M
        for c in by_name.get(nn, ()):
            d = haversine_m(t["lng"], t["lat"], c["lng"], c["lat"])
            if d < best_d:
                best_id, best_d = c["id"], d
        if best_id is None:
            missed.append(t)
        else:
            matched_c.add(best_id)

    phantom = sum(1 for r in collected_rows if r["id"] not in matched_c)

    # 采集库内部的重复对(同名且距离<DUP_M); 同名组通常只有 1~2 条, 直接两两比
    dup_pairs = 0
    for group in by_name.values():
        if len(group) < 2:
            continue
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                if haversine_m(group[i]["lng"], group[i]["lat"],
                               group[j]["lng"], group[j]["lat"]) < DUP_M:
                    dup_pairs += 1

    n = len(truth_pois)
    return {
        "truth_total": n,
        "collected_total": len(collected_rows),
        "missed": len(missed),
        "miss_rate": len(missed) / n if n else 0,
        "dup_matches": dup_pairs,
        "dup_rate": dup_pairs / n if n else 0,
        "phantom": phantom,
        "missed_samples": [
            {"name": t["name"], "address": t["address"],
             "lng": t["lng"], "lat": t["lat"]} for t in missed[:20]],
    }
