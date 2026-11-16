"""点位规范化与去重。

同一门店会在相邻网格的边界上重复出现, 入库前去重:
  1. 主键去重: md5(规范名称|规范地址) —— 同一名称同一地址视为同一家店;
  2. 空间去重: 规范名称相同且距离 < 25m —— 兜底地址写法略有差异的情况。
"""
import hashlib
import re
import unicodedata

from .geo import haversine_m

SPATIAL_DEDUP_M = 25.0

_PUNCT = re.compile(r"[\s,，.。()()【】\[\]、\-—_#]+")


def normalize(text):
    """全角转半角、去标点空白、转小写。"""
    if not text:
        return ""
    t = unicodedata.normalize("NFKC", text)
    t = _PUNCT.sub("", t)
    return t.lower()


def dedup_key(name, address):
    return hashlib.md5(f"{normalize(name)}|{normalize(address)}".encode("utf-8")).hexdigest()


class Deduper:
    """对一个项目内的点位库做去重判断(直接读 SQLite)。"""

    def __init__(self, db, project_id):
        self.db = db
        self.project_id = project_id

    def find_existing(self, name, address, lng, lat):
        """返回已存在的同店 id, 没有则 None。"""
        key = dedup_key(name, address)
        row = self.db.one(
            "SELECT id FROM pois WHERE project_id=? AND dedup_key=?",
            (self.project_id, key))
        if row:
            return row["id"], key
        # 空间兜底: 同名且距离很近
        name_norm = normalize(name)
        if name_norm:
            rows = self.db.query(
                "SELECT id, lng, lat FROM pois WHERE project_id=? AND name_norm=?",
                (self.project_id, name_norm))
            for r in rows:
                if haversine_m(lng, lat, r["lng"], r["lat"]) < SPATIAL_DEDUP_M:
                    return r["id"], key
        return None, key
