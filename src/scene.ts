import { mat4Between, mat4TRS, type Vec3 } from './math';
import type { WorkshopSpec } from './config';
import type { Simulation } from './physics';
import type { Renderer } from './render';

const COL = {
  floor: [0.16, 0.17, 0.19] as [number, number, number],
  grid: [0.28, 0.3, 0.33] as [number, number, number],
  curb: [0.32, 0.34, 0.38] as [number, number, number],
  column: [0.36, 0.38, 0.42] as [number, number, number],
  rail: [0.45, 0.46, 0.5] as [number, number, number],
  girder: [0.85, 0.62, 0.12] as [number, number, number],
  truck: [0.6, 0.45, 0.12] as [number, number, number],
  trolley: [0.68, 0.7, 0.74] as [number, number, number],
  hook: [0.2, 0.2, 0.23] as [number, number, number],
  rope: [0.13, 0.13, 0.15] as [number, number, number],
  obstacle: [0.72, 0.45, 0.16] as [number, number, number],
  obstacleTop: [0.55, 0.34, 0.12] as [number, number, number],
  alarm: [0.95, 0.15, 0.15] as [number, number, number],
  target: [0.2, 0.9, 0.4] as [number, number, number],
};

export interface SceneOpts {
  sim: Simulation | null;
  ws: WorkshopSpec;
  alarm: boolean;
  timeMs: number;
}

export function drawWorld(r: Renderer, o: SceneOpts): void {
  const { ws, sim } = o;
  const L = ws.size.x;
  const W = ws.size.z;
  const H = ws.craneHeight;

  // 地面与网格
  r.draw(r.box, mat4TRS(0, -0.06, 0, 0, L + 8, 0.12, W + 8), COL.floor);
  r.draw(r.grid, mat4TRS(0, 0.01, 0, 0, L, 1, W), COL.grid, 0.6);

  // 四周矮墙（边界）
  r.draw(r.box, mat4TRS(0, 0.25, W / 2 + 0.15, 0, L, 0.5, 0.3), COL.curb);
  r.draw(r.box, mat4TRS(0, 0.25, -W / 2 - 0.15, 0, L, 0.5, 0.3), COL.curb);
  r.draw(r.box, mat4TRS(L / 2 + 0.15, 0.25, 0, 0, 0.3, 0.5, W), COL.curb);
  r.draw(r.box, mat4TRS(-L / 2 - 0.15, 0.25, 0, 0, 0.3, 0.5, W), COL.curb);

  // 立柱与轨道
  const zRail = W / 2 - 1;
  for (let x = -L / 2 + 3; x <= L / 2 - 3; x += 6) {
    r.draw(r.box, mat4TRS(x, (H + 1.4) / 2, zRail + 1.2, 0, 0.4, H + 1.4, 0.4), COL.column);
    r.draw(r.box, mat4TRS(x, (H + 1.4) / 2, -zRail - 1.2, 0, 0.4, H + 1.4, 0.4), COL.column);
  }
  r.draw(r.box, mat4TRS(0, H + 1.05, zRail, 0, L, 0.25, 0.25), COL.rail);
  r.draw(r.box, mat4TRS(0, H + 1.05, -zRail, 0, L, 0.25, 0.25), COL.rail);

  // 障碍物（报警时最近的红闪）
  const flash = o.alarm && Math.floor(o.timeMs / 250) % 2 === 0;
  for (const ob of ws.obstacles) {
    const sx = ob.max.x - ob.min.x;
    const sy = ob.max.y - ob.min.y;
    const sz = ob.max.z - ob.min.z;
    const cx = (ob.min.x + ob.max.x) / 2;
    const cz = (ob.min.z + ob.max.z) / 2;
    const col = flash ? COL.alarm : COL.obstacle;
    r.draw(r.box, mat4TRS(cx, sy / 2, cz, 0, sx, sy, sz), col);
    r.draw(r.box, mat4TRS(cx, sy + 0.03, cz, 0, sx * 0.96, 0.06, sz * 0.96), COL.obstacleTop);
  }

  // 目标垛位（绿色半透明 + 边框）
  const t = ws.target;
  const pulse = 0.28 + 0.12 * Math.sin(o.timeMs / 300);
  r.draw(r.box, mat4TRS(t.x, 0.02, t.z, 0, t.r * 2, 0.04, t.r * 2), COL.target, pulse);
  const e = 0.08;
  r.draw(r.box, mat4TRS(t.x, 0.05, t.z - t.r, 0, t.r * 2 + e, 0.1, e), COL.target, 0.9);
  r.draw(r.box, mat4TRS(t.x, 0.05, t.z + t.r, 0, t.r * 2 + e, 0.1, e), COL.target, 0.9);
  r.draw(r.box, mat4TRS(t.x - t.r, 0.05, t.z, 0, e, 0.1, t.r * 2 + e), COL.target, 0.9);
  r.draw(r.box, mat4TRS(t.x + t.r, 0.05, t.z, 0, e, 0.1, t.r * 2 + e), COL.target, 0.9);

  if (!sim) return;

  const bx = sim.bridgeX;
  const tz = sim.trolleyZ;

  // 大车：端梁 + 主梁
  r.draw(r.box, mat4TRS(bx, H + 0.7, zRail, 0, 1.6, 0.7, 0.9), COL.truck);
  r.draw(r.box, mat4TRS(bx, H + 0.7, -zRail, 0, 1.6, 0.7, 0.9), COL.truck);
  r.draw(r.box, mat4TRS(bx, H + 0.6, 0, 0, 1.0, 0.9, zRail * 2 + 1), COL.girder);

  // 小车
  r.draw(r.box, mat4TRS(bx, H + 0.25, tz, 0, 1.3, 0.5, 1.3), COL.trolley);

  // 吊钩
  const hp = sim.hookP;
  r.draw(r.box, mat4TRS(hp.x, hp.y, hp.z, 0, 0.4, 0.55, 0.3), COL.hook);
  r.draw(r.box, mat4TRS(hp.x, hp.y - 0.4, hp.z, 0, 0.14, 0.3, 0.14), COL.hook);

  // 钢丝绳（两根，视觉上加粗）
  const attach = sim.attach;
  for (const off of [-0.14, 0.14]) {
    r.draw(
      r.cyl,
      mat4Between(
        { x: attach.x + off, y: attach.y, z: attach.z },
        { x: hp.x + off * 0.5, y: hp.y + 0.28, z: hp.z },
        0.025,
      ),
      COL.rope,
    );
  }

  // 吊物
  const lp = sim.loadP;
  const load = sim.load;
  const s = load.size;
  const topY = lp.y + s.y / 2;
  if (load.shape === 'coil') {
    const a: Vec3 = { x: lp.x, y: lp.y, z: lp.z - s.z / 2 };
    const b: Vec3 = { x: lp.x, y: lp.y, z: lp.z + s.z / 2 };
    r.draw(r.cyl, mat4Between(a, b, s.y / 2), load.color);
    r.draw(r.cyl, mat4Between(
      { x: lp.x, y: lp.y, z: lp.z - s.z / 2 - 0.02 },
      { x: lp.x, y: lp.y, z: lp.z + s.z / 2 + 0.02 },
      s.y / 5,
    ), [0.2, 0.22, 0.25]);
  } else if (load.shape === 'plate') {
    r.draw(r.box, mat4TRS(lp.x, lp.y, lp.z, 0, s.x, s.y, s.z), load.color);
  } else {
    r.draw(r.box, mat4TRS(lp.x, lp.y, lp.z, 0, s.x, s.y, s.z), load.color);
    r.draw(r.box, mat4TRS(lp.x, topY + s.y * 0.12, lp.z, 0, s.x * 0.55, s.y * 0.25, s.z * 0.55), load.color);
  }

  // 索具（吊钩 → 吊物吊点）
  const hookBottom: Vec3 = { x: hp.x, y: hp.y - 0.5, z: hp.z };
  let anchors: Vec3[];
  if (load.shape === 'coil') {
    anchors = [
      { x: lp.x, y: topY, z: lp.z - s.z * 0.3 },
      { x: lp.x, y: topY, z: lp.z + s.z * 0.3 },
    ];
  } else {
    anchors = [
      { x: lp.x - s.x * 0.38, y: topY, z: lp.z - s.z * 0.32 },
      { x: lp.x + s.x * 0.38, y: topY, z: lp.z - s.z * 0.32 },
      { x: lp.x - s.x * 0.38, y: topY, z: lp.z + s.z * 0.32 },
      { x: lp.x + s.x * 0.38, y: topY, z: lp.z + s.z * 0.32 },
    ];
  }
  for (const a of anchors) {
    r.draw(r.cyl, mat4Between(hookBottom, a, 0.018), COL.rope);
  }
}
