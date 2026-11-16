"""SQLite 存储层: 项目 / 网格 / 点位 / 快照 / 变化。"""
import sqlite3
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  region TEXT NOT NULL,            -- 行政区多边形 JSON [[lng,lat],...]
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS grids(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  parent_id INTEGER,               -- 四分时的父格
  min_lng REAL NOT NULL, min_lat REAL NOT NULL,
  max_lng REAL NOT NULL, max_lat REAL NOT NULL,
  depth INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending/running/done/done_empty/failed/split/overflow
  result_count INTEGER DEFAULT 0,  -- 接口报告的格内总数
  attempts INTEGER DEFAULT 0,      -- 已尝试请求次数
  note TEXT DEFAULT '',
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_grids_proj ON grids(project_id, status);
CREATE TABLE IF NOT EXISTS snapshots(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  poi_count INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pois(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  dedup_key TEXT NOT NULL,         -- md5(规范名|规范地址)
  name TEXT, name_norm TEXT,
  address TEXT, addr_norm TEXT,
  brand TEXT, category TEXT,
  lng REAL, lat REAL,              -- WGS84
  status TEXT NOT NULL DEFAULT 'active',   -- active/closed
  first_seen INTEGER,              -- 首次出现的快照
  last_seen INTEGER,               -- 最近一次采到的快照
  UNIQUE(project_id, dedup_key)
);
CREATE INDEX IF NOT EXISTS idx_pois_name ON pois(project_id, name_norm);
CREATE INDEX IF NOT EXISTS idx_pois_seen ON pois(project_id, last_seen);
CREATE TABLE IF NOT EXISTS snapshot_pois(
  snapshot_id INTEGER NOT NULL,
  poi_id INTEGER NOT NULL,
  UNIQUE(snapshot_id, poi_id)     -- 每次快照采到哪些点位, 不受 last_seen 覆盖影响
);
CREATE TABLE IF NOT EXISTS changes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL,
  change_type TEXT NOT NULL,       -- new/closed/moved
  poi_id INTEGER,
  related_poi_id INTEGER,          -- moved 时的新点位 id
  detail TEXT
);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
"""


def now():
    return time.strftime("%Y-%m-%d %H:%M:%S")


class DB:
    def __init__(self, path):
        self.conn = sqlite3.connect(path, timeout=30)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.executescript(SCHEMA)
        self.conn.commit()
        self._tx = 0  # >0 表示在显式事务中, execute 不自动提交

    def begin(self):
        """进入显式事务: 之后的 execute 不逐条提交, 直到 commit()。"""
        self._tx += 1

    def commit(self):
        self._tx = max(0, self._tx - 1)
        if self._tx == 0:
            self.conn.commit()

    def execute(self, sql, args=()):
        cur = self.conn.execute(sql, args)
        if self._tx == 0:
            self.conn.commit()
        return cur

    def query(self, sql, args=()):
        return self.conn.execute(sql, args).fetchall()

    def one(self, sql, args=()):
        return self.conn.execute(sql, args).fetchone()

    def close(self):
        self.conn.close()
