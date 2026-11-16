"""几何工具: 经纬度距离 / 点在多边形 / 矩形与多边形相交。"""
import math

EARTH_R = 6371000.0


def haversine_m(lng1, lat1, lng2, lat2):
    """两经纬度点间距离(米)。"""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(min(1.0, math.sqrt(a)))


def point_in_polygon(lng, lat, poly):
    """射线法, poly = [(lng,lat), ...]。"""
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > lat) != (yj > lat):
            x_cross = (xj - xi) * (lat - yi) / (yj - yi) + xi
            if lng < x_cross:
                inside = not inside
        j = i
    return inside


def _seg_intersect(a, b, c, d):
    """线段 ab 与 cd 是否相交(含共线端点接触)。"""
    def cross(o, p, q):
        return (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
    d1 = cross(c, d, a)
    d2 = cross(c, d, b)
    d3 = cross(a, b, c)
    d4 = cross(a, b, d)
    if ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0)):
        return True
    def on(o, p, q):
        return (min(o[0], q[0]) <= p[0] <= max(o[0], q[0])
                and min(o[1], q[1]) <= p[1] <= max(o[1], q[1]))
    if d1 == 0 and on(c, a, d):
        return True
    if d2 == 0 and on(c, b, d):
        return True
    if d3 == 0 and on(a, c, b):
        return True
    if d4 == 0 and on(a, d, b):
        return True
    return False


def rect_intersects_polygon(minx, miny, maxx, maxy, poly):
    """矩形(网格)是否与多边形(行政区)相交。

    三条规则覆盖全部情形: 多边形顶点在矩形内 / 矩形角点在多边形内 / 边相交。
    """
    for x, y in poly:
        if minx <= x <= maxx and miny <= y <= maxy:
            return True
    corners = [(minx, miny), (minx, maxy), (maxx, miny), (maxx, maxy)]
    for cx, cy in corners:
        if point_in_polygon(cx, cy, poly):
            return True
    rect_edges = list(zip(corners, corners[1:] + corners[:1]))
    n = len(poly)
    for i in range(n):
        p1, p2 = poly[i], poly[(i + 1) % n]
        for r1, r2 in rect_edges:
            if _seg_intersect(p1, p2, r1, r2):
                return True
    return False


def polygon_bbox(poly):
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return min(xs), min(ys), max(xs), max(ys)
