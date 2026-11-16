"""POI 点位采集系统(纯本地模拟,不调用任何真实地图平台).

模块:
  coords      坐标系转换 (WGS84 <-> GCJ-02)
  geo         几何工具 (多边形 / 矩形 / 距离)
  db          SQLite 存储
  mock_data   模拟城市点位真值生成与演化
  mock_server 模拟地图开放平台搜索接口
  dedup       点位规范化与去重
  engine      采集引擎 (网格四分 / 重试 / 断点续采)
  changes     快照间变化追踪 (新开 / 关门 / 搬家)
  coverage    覆盖分析
  verify      与真值比对 (漏采率 / 重复率)
  webapp      本地后台 + 覆盖地图
"""

__version__ = "1.0.0"
