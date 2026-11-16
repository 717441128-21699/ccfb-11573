"""模拟城市点位真值(WGS84)的生成与演化。

真值只落盘在 data/ 下, 模拟接口和验证程序读取; 采集引擎永远看不到它。
演化(evolve)模拟"一个月后": 一部分关门、一部分新开张、一部分搬家。
"""
import json
import os
import random

from .geo import point_in_polygon, polygon_bbox

# 默认模拟城市: 一个八边形行政区, 约 26km x 22km
REGION_POLY = [
    [116.22, 39.84], [116.30, 39.815], [116.44, 39.815], [116.48, 39.85],
    [116.48, 39.955], [116.42, 39.99], [116.28, 39.99], [116.215, 39.94],
]

# 商圈(扎堆): 中心 + 高斯 sigma(度) + 权重
CLUSTERS = [
    {"name": "望京",   "center": (116.30, 39.945), "sigma": 0.0040, "weight": 1.3},
    {"name": "国贸",   "center": (116.44, 39.880), "sigma": 0.0035, "weight": 1.2},
    {"name": "亚运村", "center": (116.40, 39.965), "sigma": 0.0040, "weight": 1.0},
    {"name": "双井",   "center": (116.45, 39.870), "sigma": 0.0030, "weight": 0.9},
    {"name": "西二旗", "center": (116.27, 39.970), "sigma": 0.0045, "weight": 0.8},
    {"name": "古城",   "center": (116.24, 39.880), "sigma": 0.0040, "weight": 0.8},
]

BRANDS = [
    "星巴克", "瑞幸咖啡", "麦当劳", "肯德基", "蜜雪冰城", "海底捞", "便利蜂",
    "7-ELEVEn", "全家", "罗森", "沙县小吃", "兰州拉面", "黄焖鸡米饭",
    "绝味鸭脖", "喜茶", "奈雪的茶", "汉堡王", "必胜客", "永和大王", "链家",
]
CATEGORIES = {
    "星巴克": "咖啡", "瑞幸咖啡": "咖啡", "喜茶": "茶饮", "奈雪的茶": "茶饮",
    "蜜雪冰城": "茶饮", "便利蜂": "便利店", "7-ELEVEn": "便利店",
    "全家": "便利店", "罗森": "便利店", "链家": "房产中介",
}
ROADS = [
    "建国路", "朝阳路", "望京街", "中关村大街", "三里屯路", "国贸大道",
    "和平街", "亚运村路", "双井桥路", "大望路", "青年路", "十里堡路",
    "酒仙桥路", "将台路", "阜通大街", "广渠门大街", "崇文门大街",
    "宣武门大街", "金融街", "复兴路",
]
LANDMARKS = [
    "万达广场", "大悦城", "银泰中心", "华贸中心", "国贸商城", "太古里",
    "蓝色港湾", "合生汇", "万象汇", "凯德MALL", "龙湖天街", "新世界百货",
]


def _rand_point_in_poly(rng, poly, bbox):
    while True:
        lng = rng.uniform(bbox[0], bbox[2])
        lat = rng.uniform(bbox[1], bbox[3])
        if point_in_polygon(lng, lat, poly):
            return lng, lat


def _unique_name(rng, used_names):
    """真实连锁会对同名门店加分店序号, 保证店名全局唯一。"""
    brand = rng.choice(BRANDS)
    landmark = rng.choice(LANDMARKS)
    name = f"{brand}({landmark}店)"
    k = 2
    while name in used_names:
        name = f"{brand}({landmark}{k}店)"
        k += 1
    used_names.add(name)
    return brand, name


def _make_poi(rng, pid, lng, lat, used_keys, used_names):
    brand, name = _unique_name(rng, used_names)
    road = rng.choice(ROADS)
    number = rng.randint(1, 999)
    # 保证 (名称, 地址) 组合唯一 —— 真值里不存在两家完全同址同名的店
    while (name, road, number) in used_keys:
        number = rng.randint(1, 999)
    used_keys.add((name, road, number))
    return {
        "id": pid,
        "name": name,
        "address": f"{road}{number}号",
        "brand": brand,
        "category": CATEGORIES.get(brand, "餐饮"),
        "lng": round(lng, 7),
        "lat": round(lat, 7),
    }


def generate(n_total=100000, seed=42, poly=None, clusters=None, cluster_ratio=0.75):
    """生成真值点位: cluster_ratio 扎堆在商圈, 其余均匀散布(空旷郊区)。"""
    poly = poly or REGION_POLY
    clusters = clusters or CLUSTERS
    bbox = polygon_bbox(poly)
    rng = random.Random(seed)
    pois, used_keys, used_names = [], set(), set()
    pid = 1

    n_cluster = int(n_total * cluster_ratio)
    total_w = sum(c["weight"] for c in clusters)
    for c in clusters:
        target = int(n_cluster * c["weight"] / total_w)
        made = 0
        while made < target:
            lng = rng.gauss(c["center"][0], c["sigma"])
            lat = rng.gauss(c["center"][1], c["sigma"] * 0.85)
            if not point_in_polygon(lng, lat, poly):
                continue
            pois.append(_make_poi(rng, pid, lng, lat, used_keys, used_names))
            pid += 1
            made += 1

    while len(pois) < n_total:
        lng, lat = _rand_point_in_poly(rng, poly, bbox)
        pois.append(_make_poi(rng, pid, lng, lat, used_keys, used_names))
        pid += 1

    return {"region": poly, "pois": pois}


def evolve(truth, seed=99, n_close=400, n_new=600, n_move=250):
    """模拟一个月后的变化: 关门 / 新开 / 搬家。返回新的真值 dict。"""
    rng = random.Random(seed)
    poly = truth["region"]
    bbox = polygon_bbox(poly)
    pois = [dict(p) for p in truth["pois"]]
    rng.shuffle(pois)

    closed = pois[:n_close]
    moved = pois[n_close:n_close + n_move]
    kept = pois[n_close + n_move:]

    for p in moved:  # 搬家: 名字不变, 坐标挪 ~100m, 门牌号换
        p["lng"] = round(p["lng"] + rng.gauss(0, 0.0008), 7)
        p["lat"] = round(p["lat"] + rng.gauss(0, 0.0008), 7)
        p["address"] = f"{rng.choice(ROADS)}{rng.randint(1, 999)}号"

    used_keys = {(p["name"], p["address"]) for p in kept}
    used_names = {p["name"] for p in kept}
    max_id = max(p["id"] for p in truth["pois"])
    new_pois = []
    pid = max_id + 1
    while len(new_pois) < n_new:
        lng, lat = _rand_point_in_poly(rng, poly, bbox)
        brand, name = _unique_name(rng, used_names)
        addr = f"{rng.choice(ROADS)}{rng.randint(1, 999)}号"
        if (name, addr) in used_keys:
            continue
        used_keys.add((name, addr))
        new_pois.append({
            "id": pid, "name": name, "address": addr, "brand": brand,
            "category": CATEGORIES.get(brand, "餐饮"),
            "lng": round(lng, 7), "lat": round(lat, 7),
        })
        pid += 1

    return {"region": poly, "pois": kept + moved + new_pois,
            "_meta": {"closed": len(closed), "moved": len(moved), "new": len(new_pois)}}


def save(truth, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(truth, f, ensure_ascii=False, separators=(",", ":"))


def load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)
