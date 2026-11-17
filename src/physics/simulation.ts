import type { LoadSpec, SessionConfig, Vec3, WorkshopSpec } from '../types';
import { DRIVE_LIMITS, LOADS, getStartPose, getWorkshop } from '../config';
import { clamp, makeAABB } from './math3d';
import { createAxis, stepAxis, type PendulumAxis } from './pendulum';
import { checkCollisions, loadBox } from './collision';

/** 固定物理步长 1 ms */
export const PHYSICS_DT = 0.001;

/** 操作手柄 / 键盘归一化指令，范围 -1..1。hoist：+1 放绳下降，-1 起升 */
export interface DriveCommand {
  gantry: number; // 大车，+X 方向
  trolley: number; // 小车，+Z 方向
  hoist: number;
}

export type SimStatus = 'running' | 'landed' | 'failed';

export interface SimMetrics {
  elapsed: number;
  /** 吊物摆角峰值（度，取两轴最大值） */
  maxLoadSwingDeg: number;
  /** 吊钩摆角峰值（度） */
  maxHookSwingDeg: number;
  /** 摆角超过 5° 的累计时长 s */
  swingOverLimitTime: number;
  /** 0.5 m 报警事件次数（进入报警区计一次） */
  alarmCount: number;
  /** 处于报警距离内的累计时长 s */
  alarmTime: number;
  /** 与障碍物最小净距 m */
  minGap: number;
  /** 硬碰撞次数（碰上即失败，正常为 0 或 1） */
  collisionCount: number;
  /** 完成时落点与垛位中心的水平偏差 m */
  landingError: number;
  /** 落地瞬间吊物摆角（度） */
  landingSwingDeg: number;
  /** 结束原因 */
  finishReason: string | null;
}

export interface KinematicSnapshot {
  time: number;
  pivot: Vec3;
  hook: Vec3;
  load: Vec3;
  rope: number;
  thetaHookX: number;
  thetaHookZ: number;
  thetaLoadX: number;
  thetaLoadZ: number;
}

const SWING_LIMIT_RAD = (5 * Math.PI) / 180;
const LANDING_ALIGN_TOL = 0.4; // 落点水平容差 m
const LANDING_SPEED_TOL = 0.25; // 落点水平速度容差 m/s
const LANDING_SWING_TOL = (5 * Math.PI) / 180;
const HOOK_HALF: Vec3 = { x: 0.22, y: 0.35, z: 0.22 };

export class CraneSimulation {
  readonly workshop: WorkshopSpec;
  readonly load: LoadSpec;
  readonly studentName: string;

  // 机构状态
  x: number;
  z: number;
  vx = 0;
  vz = 0;
  private prevVx = 0;
  private prevVz = 0;
  rope: number;
  vRope = 0;

  // 双摆：X 向（大车方向）与 Z 向（小车方向）解耦
  readonly axisX: PendulumAxis = createAxis();
  readonly axisZ: PendulumAxis = createAxis();

  status: SimStatus = 'running';
  readonly metrics: SimMetrics = {
    elapsed: 0,
    maxLoadSwingDeg: 0,
    maxHookSwingDeg: 0,
    swingOverLimitTime: 0,
    alarmCount: 0,
    alarmTime: 0,
    minGap: Infinity,
    collisionCount: 0,
    landingError: 0,
    landingSwingDeg: 0,
    finishReason: null,
  };

  private alarmActive = false;
  private prevLoad: Vec3;
  loadVelocity: Vec3 = { x: 0, y: 0, z: 0 };
  private snapshotPrev: KinematicSnapshot;
  private snapshotCur: KinematicSnapshot;

  constructor(config: SessionConfig) {
    this.workshop = getWorkshop(config.workshopId);
    this.load = LOADS[config.loadKind];
    this.studentName = config.studentName;
    const start = getStartPose(config.workshopId);
    this.x = start.x;
    this.z = start.z;
    this.rope = start.rope;
    this.prevLoad = this.loadPosition();
    this.snapshotPrev = this.buildSnapshot();
    this.snapshotCur = this.buildSnapshot();
  }

  /** 当前目标垛位（每车间取第一个，教练可在配置中扩展） */
  get target() {
    return this.workshop.targets[0];
  }

  get pivotPosition(): Vec3 {
    return { x: this.x, y: this.workshop.pivotY, z: this.z };
  }

  hookPosition(): Vec3 {
    const p = this.pivotPosition;
    return {
      x: p.x + this.rope * Math.sin(this.axisX.theta1),
      y: p.y - this.rope * Math.cos(this.axisX.theta1) * Math.cos(this.axisZ.theta1),
      z: p.z + this.rope * Math.sin(this.axisZ.theta1),
    };
  }

  loadPosition(): Vec3 {
    const h = this.hookPosition();
    const L2 = this.load.slingLength;
    return {
      x: h.x + L2 * Math.sin(this.axisX.theta2),
      y: h.y - L2 * Math.cos(this.axisX.theta2) * Math.cos(this.axisZ.theta2),
      z: h.z + L2 * Math.sin(this.axisZ.theta2),
    };
  }

  /** 推进一个 1ms 物理步 */
  step(cmd: DriveCommand): void {
    if (this.status !== 'running') return;
    const dt = PHYSICS_DT;
    this.metrics.elapsed += dt;

    this.stepDrives(cmd, dt);

    const pivotAccX = (this.vx - this.prevVx) / dt;
    const pivotAccZ = (this.vz - this.prevVz) / dt;
    this.prevVx = this.vx;
    this.prevVz = this.vz;

    const common = {
      L1: this.rope,
      L1dot: this.vRope,
      L2: this.load.slingLength,
      m1: this.load.hookMass,
      m2: this.load.mass,
      dt,
    };
    stepAxis(this.axisX, { ...common, pivotAcc: pivotAccX });
    stepAxis(this.axisZ, { ...common, pivotAcc: pivotAccZ });

    // 吊物速度（数值差分，用于落地判定）
    const load = this.loadPosition();
    this.loadVelocity = {
      x: (load.x - this.prevLoad.x) / dt,
      y: (load.y - this.prevLoad.y) / dt,
      z: (load.z - this.prevLoad.z) / dt,
    };
    this.prevLoad = load;

    this.updateMetrics();
    this.checkContacts(load);

    this.snapshotPrev = this.snapshotCur;
    this.snapshotCur = this.buildSnapshot();
  }

  /** 速度斜坡驱动模型：指令 -> 目标速度，按加速度限值逼近 */
  private stepDrives(cmd: DriveCommand, dt: number) {
    const lim = DRIVE_LIMITS;
    this.vx = rampSpeed(this.vx, cmd.gantry * lim.gantryMaxSpeed, lim.gantryAccel, dt);
    this.vz = rampSpeed(this.vz, cmd.trolley * lim.trolleyMaxSpeed, lim.trolleyAccel, dt);
    this.vRope = rampSpeed(this.vRope, cmd.hoist * lim.hoistMaxSpeed, lim.hoistAccel, dt);

    const [xMin, xMax] = this.workshop.travelX;
    const [zMin, zMax] = this.workshop.travelZ;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    if (this.x <= xMin || this.x >= xMax) {
      this.x = clamp(this.x, xMin, xMax);
      this.vx = 0;
    }
    if (this.z <= zMin || this.z >= zMax) {
      this.z = clamp(this.z, zMin, zMax);
      this.vz = 0;
    }

    this.rope += this.vRope * dt;
    if (this.rope <= this.workshop.ropeMin || this.rope >= this.workshop.ropeMax) {
      this.rope = clamp(this.rope, this.workshop.ropeMin, this.workshop.ropeMax);
      this.vRope = 0;
    }
  }

  private updateMetrics() {
    const m = this.metrics;
    const hookSwing = Math.max(Math.abs(this.axisX.theta1), Math.abs(this.axisZ.theta1));
    const loadSwing = Math.max(Math.abs(this.axisX.theta2), Math.abs(this.axisZ.theta2));
    m.maxHookSwingDeg = Math.max(m.maxHookSwingDeg, (hookSwing * 180) / Math.PI);
    m.maxLoadSwingDeg = Math.max(m.maxLoadSwingDeg, (loadSwing * 180) / Math.PI);
    if (loadSwing > SWING_LIMIT_RAD) m.swingOverLimitTime += PHYSICS_DT;
  }

  private checkContacts(load: Vec3) {
    const m = this.metrics;
    const lBox = loadBox(load, this.load.half);
    const hPos = this.hookPosition();
    const hBox = makeAABB(hPos, HOOK_HALF);

    // 障碍物：吊钩与吊物分别检测，取最危险结果
    const r1 = checkCollisions(lBox, this.workshop.obstacles);
    const r2 = checkCollisions(hBox, this.workshop.obstacles);
    const near = r1.minGap <= r2.minGap ? r1 : r2;
    const hit = r1.hit || r2.hit;
    const hitLabel = r1.hitLabel ?? r2.hitLabel;

    if (near.minGap < m.minGap) m.minGap = near.minGap;

    if (near.nearLabels.length > 0) {
      if (!this.alarmActive) {
        m.alarmCount += 1;
        this.alarmActive = true;
      }
      m.alarmTime += PHYSICS_DT;
    } else {
      this.alarmActive = false;
    }

    if (hit) {
      m.collisionCount += 1;
      this.fail(`碰撞障碍物：${hitLabel}`);
      return;
    }

    // 行程极限只约束机构本身（stepDrives 中钳制 x/z），吊物摆动越线不算碰撞

    // 落地 / 落垛判定
    const loadBottom = load.y - this.load.half.y;
    const targetTop = this.target.center.y + this.target.half.y;
    if (loadBottom <= targetTop + 0.02) {
      const dx = load.x - this.target.center.x;
      const dz = load.z - this.target.center.z;
      const horizontalError = Math.hypot(dx, dz);
      const swing = Math.max(Math.abs(this.axisX.theta2), Math.abs(this.axisZ.theta2));
      const horizontalSpeed = Math.hypot(this.loadVelocity.x, this.loadVelocity.z);
      m.landingError = horizontalError;
      m.landingSwingDeg = (swing * 180) / Math.PI;

      if (horizontalError > LANDING_ALIGN_TOL) {
        this.fail('未对准垛位落地');
      } else if (horizontalSpeed > LANDING_SPEED_TOL) {
        this.fail('落地时水平速度过大');
      } else if (swing > LANDING_SWING_TOL) {
        this.fail('落地时吊物摆角超过 5°');
      } else {
        this.status = 'landed';
        m.finishReason = '安全落垛';
      }
    }
  }

  private fail(reason: string) {
    this.status = 'failed';
    this.metrics.finishReason = reason;
  }

  private buildSnapshot(): KinematicSnapshot {
    return {
      time: this.metrics.elapsed,
      pivot: this.pivotPosition,
      hook: this.hookPosition(),
      load: this.loadPosition(),
      rope: this.rope,
      thetaHookX: this.axisX.theta1,
      thetaHookZ: this.axisZ.theta1,
      thetaLoadX: this.axisX.theta2,
      thetaLoadZ: this.axisZ.theta2,
    };
  }

  /** 渲染插值状态：alpha ∈ [0,1)，在最近两个物理快照间线性插值，保证 60 fps 平滑 */
  getRenderState(alpha: number): KinematicSnapshot {
    const a = this.snapshotPrev;
    const b = this.snapshotCur;
    const t = clamp(alpha, 0, 1);
    const lerpV = (p: Vec3, q: Vec3) => ({
      x: p.x + (q.x - p.x) * t,
      y: p.y + (q.y - p.y) * t,
      z: p.z + (q.z - p.z) * t,
    });
    return {
      time: a.time + (b.time - a.time) * t,
      pivot: lerpV(a.pivot, b.pivot),
      hook: lerpV(a.hook, b.hook),
      load: lerpV(a.load, b.load),
      rope: a.rope + (b.rope - a.rope) * t,
      thetaHookX: a.thetaHookX + (b.thetaHookX - a.thetaHookX) * t,
      thetaHookZ: a.thetaHookZ + (b.thetaHookZ - a.thetaHookZ) * t,
      thetaLoadX: a.thetaLoadX + (b.thetaLoadX - a.thetaLoadX) * t,
      thetaLoadZ: a.thetaLoadZ + (b.thetaLoadZ - a.thetaLoadZ) * t,
    };
  }
}

function rampSpeed(current: number, target: number, accel: number, dt: number): number {
  const diff = target - current;
  const step = accel * dt;
  if (Math.abs(diff) <= step) return target;
  return current + Math.sign(diff) * step;
}
