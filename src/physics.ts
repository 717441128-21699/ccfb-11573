import type { Vec3 } from './math';
import type { LoadSpec, WorkshopSpec } from './config';

export interface Cmd {
  b: number;     // 大车指令 -1..1（+x）
  t: number;     // 小车指令 -1..1（+z）
  h: number;     // 起升指令 -1..1（+上升）
  inch: boolean; // 微动
}

const G = 9.81;

// 机构参数：最大速度 / 加速度
const BRIDGE = { vMax: 1.4, accel: 0.5 };
const TROLLEY = { vMax: 1.0, accel: 0.45 };
const HOIST = { vMax: 0.6, accel: 0.9 };
const INCH_FACTOR = 0.2;

const ROPE_MIN = 1.2;

/**
 * 双摆模型：吊钩、吊物各为一个质点，
 * 吊点(小车)→吊钩 为钢丝绳(长度=绳长，随起升变化)，
 * 吊钩→吊物 为索具(长度=rigLen)。
 * Verlet 积分 + 约束投影，1ms 步长下稳定，
 * 绳长变化时摆动周期自然随之变化（T≈2π√(L/g)）。
 */
export class Simulation {
  bridgeX: number;
  trolleyZ: number;
  ropeLen: number;
  vB = 0;
  vT = 0;
  vH = 0;

  hookP: Vec3;
  hookPP: Vec3; // Verlet 上一帧位置（测试/调试可直接读写）
  loadP: Vec3;
  loadPP: Vec3;

  resting = false;   // 吊物落在地面
  collision = false; // 本步发生碰撞
  alarm = false;     // 本步处于 0.5m 报警区
  minObsDist = Infinity;

  constructor(
    public readonly ws: WorkshopSpec,
    public readonly load: LoadSpec,
  ) {
    this.bridgeX = ws.start.x;
    this.trolleyZ = ws.start.z;
    const halfY = load.size.y / 2;
    const loadY = halfY + 0.35; // 初始吊物离地 0.35m
    const hookY = loadY + load.rigLen;
    this.ropeLen = ws.craneHeight - hookY;
    this.hookP = { x: this.bridgeX, y: hookY, z: this.trolleyZ };
    this.hookPP = { ...this.hookP };
    this.loadP = { x: this.bridgeX, y: loadY, z: this.trolleyZ };
    this.loadPP = { ...this.loadP };
  }

  /** 吊点（小车）位置 */
  get attach(): Vec3 {
    return { x: this.bridgeX, y: this.ws.craneHeight, z: this.trolleyZ };
  }

  /** 吊物速度 m/s（由 Verlet 位移估算，按 1ms 步长） */
  get loadSpeed(): number {
    return (
      Math.hypot(
        this.loadP.x - this.loadPP.x,
        this.loadP.y - this.loadPP.y,
        this.loadP.z - this.loadPP.z,
      ) / 0.001
    );
  }

  step(dt: number, cmd: Cmd): void {
    // ---- 机构运动（加速限制 + 行程限位）----
    const f = cmd.inch ? INCH_FACTOR : 1;
    this.vB = approach(this.vB, cmd.b * BRIDGE.vMax * f, BRIDGE.accel, dt);
    this.vT = approach(this.vT, cmd.t * TROLLEY.vMax * f, TROLLEY.accel, dt);
    this.vH = approach(this.vH, cmd.h * HOIST.vMax * f, HOIST.accel, dt);

    this.bridgeX += this.vB * dt;
    this.trolleyZ += this.vT * dt;
    this.ropeLen -= this.vH * dt; // 上升则绳长变短

    const bx = this.ws.size.x / 2 - 2;
    const tz = this.ws.size.z / 2 - 2;
    if (this.bridgeX < -bx) { this.bridgeX = -bx; this.vB = 0; }
    if (this.bridgeX > bx) { this.bridgeX = bx; this.vB = 0; }
    if (this.trolleyZ < -tz) { this.trolleyZ = -tz; this.vT = 0; }
    if (this.trolleyZ > tz) { this.trolleyZ = tz; this.vT = 0; }
    const ropeMax = this.ws.craneHeight - 0.6;
    if (this.ropeLen < ROPE_MIN) { this.ropeLen = ROPE_MIN; this.vH = Math.min(this.vH, 0); }
    if (this.ropeLen > ropeMax) { this.ropeLen = ropeMax; this.vH = Math.max(this.vH, 0); }

    // ---- 双摆：Verlet 积分 ----
    const dampHook = Math.exp(-dt / 25); // 吊钩（含滑轮组摩擦）阻尼稍大
    const dampLoad = Math.exp(-dt / 60); // 吊物空气阻尼小，摆动更持久
    integrate(this.hookP, this.hookPP, dampHook, dt);
    integrate(this.loadP, this.loadPP, dampLoad, dt);

    // ---- 约束投影（绳/索只能拉不能推：松弛时不作用）----
    const attach = this.attach;
    const wH = 1 / this.load.hookMass;
    const wL = 1 / this.load.mass;
    const wSum = wH + wL;
    for (let i = 0; i < 12; i++) {
      // 钢丝绳：|吊钩 - 吊点| ≤ 绳长（吊点为固定锚点）
      projectAnchor(this.hookP, attach, this.ropeLen);
      // 索具：|吊物 - 吊钩| ≤ rigLen，按质量比分配修正
      projectPair(this.hookP, this.loadP, this.load.rigLen, wH / wSum, wL / wSum);
    }

    // 吊钩下限：地面 / 落在吊物上
    if (this.hookP.y < 0.35) {
      this.hookP.y = 0.35;
      this.hookPP.y = 0.35;
    }
    const s = this.load.size;
    const loadTop = this.loadP.y + s.y / 2;
    if (
      this.hookP.y < loadTop + 0.3 &&
      Math.abs(this.hookP.x - this.loadP.x) < s.x / 2 + 0.2 &&
      Math.abs(this.hookP.z - this.loadP.z) < s.z / 2 + 0.2
    ) {
      this.hookP.y = loadTop + 0.3;
      this.hookPP.y = this.hookP.y;
    }

    // ---- 地面 ----
    const halfY = this.load.size.y / 2;
    this.resting = false;
    if (this.loadP.y <= halfY) {
      this.loadP.y = halfY;
      this.loadPP.y = halfY;
      // 地面摩擦
      this.loadPP.x += (this.loadP.x - this.loadPP.x) * 0.3;
      this.loadPP.z += (this.loadP.z - this.loadPP.z) * 0.3;
      this.resting = true;
    }

    // ---- 障碍物：碰撞 / 报警 ----
    const box = this.loadAABB();
    this.collision = false;
    this.minObsDist = Infinity;
    for (const o of this.ws.obstacles) {
      const dx = Math.max(0, Math.max(box.min.x - o.max.x, o.min.x - box.max.x));
      const dy = Math.max(0, Math.max(box.min.y - o.max.y, o.min.y - box.max.y));
      const dz = Math.max(0, Math.max(box.min.z - o.max.z, o.min.z - box.max.z));
      const d = Math.hypot(dx, dy, dz);
      if (d < this.minObsDist) this.minObsDist = d;
      if (d === 0) this.collision = true;
    }
    // 车间边界（墙）
    const hx = this.ws.size.x / 2;
    const hz = this.ws.size.z / 2;
    if (box.min.x < -hx || box.max.x > hx || box.min.z < -hz || box.max.z > hz) {
      this.collision = true;
    }
    this.alarm = !this.collision && this.minObsDist < 0.5;
  }

  loadAABB(): { min: Vec3; max: Vec3 } {
    const s = this.load.size;
    return {
      min: { x: this.loadP.x - s.x / 2, y: this.loadP.y - s.y / 2, z: this.loadP.z - s.z / 2 },
      max: { x: this.loadP.x + s.x / 2, y: this.loadP.y + s.y / 2, z: this.loadP.z + s.z / 2 },
    };
  }

  /** 摆角（度）：钢丝绳一级摆 + 吊物二级摆 */
  swingDeg(): { rope: number; load: number; max: number } {
    const a = this.attach;
    const rope = angleFromDown(
      this.hookP.x - a.x,
      this.hookP.y - a.y,
      this.hookP.z - a.z,
    );
    const load = angleFromDown(
      this.loadP.x - this.hookP.x,
      this.loadP.y - this.hookP.y,
      this.loadP.z - this.hookP.z,
    );
    return { rope, load, max: Math.max(rope, load) };
  }
}

function approach(v: number, target: number, accel: number, dt: number): number {
  const d = target - v;
  const m = accel * dt;
  return v + Math.max(-m, Math.min(m, d));
}

function integrate(p: Vec3, pp: Vec3, damp: number, dt: number): void {
  const vx = (p.x - pp.x) * damp;
  const vy = (p.y - pp.y) * damp;
  const vz = (p.z - pp.z) * damp;
  pp.x = p.x;
  pp.y = p.y;
  pp.z = p.z;
  p.x += vx;
  p.y += vy - G * dt * dt;
  p.z += vz;
}

function projectAnchor(p: Vec3, anchor: Vec3, restLen: number): void {
  const dx = p.x - anchor.x;
  const dy = p.y - anchor.y;
  const dz = p.z - anchor.z;
  const d = Math.hypot(dx, dy, dz) || 1e-6;
  if (d <= restLen) return; // 绳松弛，不作用
  const diff = (d - restLen) / d;
  p.x -= dx * diff;
  p.y -= dy * diff;
  p.z -= dz * diff;
}

function projectPair(a: Vec3, b: Vec3, restLen: number, wA: number, wB: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const d = Math.hypot(dx, dy, dz) || 1e-6;
  if (d <= restLen) return; // 索具松弛，不作用
  const diff = (d - restLen) / d;
  a.x += dx * diff * wA;
  a.y += dy * diff * wA;
  a.z += dz * diff * wA;
  b.x -= dx * diff * wB;
  b.y -= dy * diff * wB;
  b.z -= dz * diff * wB;
}

function angleFromDown(dx: number, dy: number, dz: number): number {
  return (Math.atan2(Math.hypot(dx, dz), -dy) * 180) / Math.PI;
}
