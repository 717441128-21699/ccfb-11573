// 基础三维类型（全部使用米 / 秒 / 弧度 / 千克）

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type LoadKind = 'coil' | 'plate' | 'mold';

/** 轴对齐包围盒 */
export interface AABB {
  min: Vec3;
  center: Vec3;
  max: Vec3;
}

/** 吊物规格：三类吊物质量、吊点（吊索长）、外形各不相同 */
export interface LoadSpec {
  kind: LoadKind;
  label: string;
  /** 吊物质量 kg */
  mass: number;
  /** 吊钩质量 kg（决定双摆第一级质量） */
  hookMass: number;
  /**
   * 吊点距离：吊钩到吊物重心的等效摆长 L2（含吊索/夹具长度），单位 m。
   * 钢卷用夹钳、钢板用钢板吊梁、模具用两根吊索，长度各不相同。
   */
  slingLength: number;
  /** 外形半尺寸 m，用于碰撞盒与三维模型 */
  half: Vec3;
  color: [number, number, number];
}

export interface Obstacle {
  id: string;
  label: string;
  half: Vec3;
  center: Vec3;
  color: [number, number, number];
}

export interface TargetSlot {
  id: string;
  label: string;
  half: Vec3;
  center: Vec3;
}

export interface WorkshopSpec {
  id: string;
  label: string;
  /** 大车（桥架 X 向）行程范围 */
  travelX: [number, number];
  /** 小车（Z 向）行程范围 */
  travelZ: [number, number];
  /** 滑轮（吊点）安装高度 m */
  pivotY: number;
  /** 钢丝绳最小 / 最大长度 m */
  ropeMin: number;
  ropeMax: number;
  obstacles: Obstacle[];
  /** 目标垛位（落垛点） */
  targets: TargetSlot[];
  /** 建议完成时限 s */
  timeLimit: number;
  /** 地面尺寸（用于画面） */
  floorSize: [number, number];
}

/** 每个学员一次完整练习的配置 */
export interface SessionConfig {
  workshopId: string;
  loadKind: LoadKind;
  studentName: string;
}
