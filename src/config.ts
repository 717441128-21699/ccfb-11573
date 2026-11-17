import type { LoadSpec, WorkshopSpec, LoadKind } from './types';

/**
 * 三类吊物：质量、吊点（等效二级摆长）、外形均不同。
 * 数值参考常见钢厂车间的典型规格，用于训练场景。
 */
export const LOADS: Record<LoadKind, LoadSpec> = {
  // 钢卷：夹钳竖直短吊，吊点低、二级摆短，摆动频率高
  coil: {
    kind: 'coil',
    label: '钢卷（夹钳）',
    mass: 22000,
    hookMass: 900,
    slingLength: 1.8,
    half: { x: 1.1, y: 1.1, z: 1.1 },
    color: [0.72, 0.75, 0.8],
  },
  // 钢板：吊梁四索，吊点高、二级摆长，摆动周期长
  plate: {
    kind: 'plate',
    label: '钢板（吊梁）',
    mass: 14000,
    hookMass: 1100,
    slingLength: 3.4,
    half: { x: 3.0, y: 0.18, z: 1.35 },
    color: [0.55, 0.62, 0.7],
  },
  // 模具：两根长吊索，质量集中，吊点最高、最难稳钩
  mold: {
    kind: 'mold',
    label: '模具（双索）',
    mass: 18000,
    hookMass: 800,
    slingLength: 4.6,
    half: { x: 1.5, y: 1.2, z: 1.5 },
    color: [0.62, 0.45, 0.32],
  },
};

/** 天车机构速度 / 加速度限值（培训用保守值） */
export const DRIVE_LIMITS = {
  /** 大车 m/s */
  gantryMaxSpeed: 1.2,
  gantryAccel: 0.5,
  /** 小车 m/s */
  trolleyMaxSpeed: 0.9,
  trolleyAccel: 0.45,
  /** 起升 m/s */
  hoistMaxSpeed: 0.45,
  hoistAccel: 0.3,
} as const;

export const WORKSHOPS: WorkshopSpec[] = [
  {
    id: 'ws-coil',
    label: '一车间 · 钢卷库',
    travelX: [-11, 11],
    travelZ: [-5.5, 5.5],
    pivotY: 9.2,
    ropeMin: 1.2,
    ropeMax: 7.4,
    floorSize: [28, 16],
    timeLimit: 150,
    obstacles: [
      { id: 'rack1', label: '料架 A', half: { x: 3.2, y: 1.6, z: 1.1 }, center: { x: -2.5, y: 1.6, z: -2.2 }, color: [0.45, 0.3, 0.22] },
      { id: 'rack2', label: '料架 B', half: { x: 2.4, y: 1.2, z: 1.1 }, center: { x: 4.2, y: 1.2, z: 1.4 }, color: [0.45, 0.3, 0.22] },
      { id: 'pillar', label: '厂房立柱', half: { x: 0.35, y: 4.5, z: 0.35 }, center: { x: 0.6, y: 4.5, z: -4.2 }, color: [0.5, 0.5, 0.55] },
      { id: 'coilstack', label: '待处理钢卷堆', half: { x: 1.4, y: 0.9, z: 1.4 }, center: { x: -7.5, y: 0.9, z: 3.2 }, color: [0.6, 0.62, 0.66] },
      // 高位防护桩：与高位吊物同高，布置在起点侧向，用于练习近距离报警与避障（不挡主作业路线）
      { id: 'bollard', label: '防护桩', half: { x: 0.4, y: 3.6, z: 0.4 }, center: { x: -8.2, y: 3.6, z: 0.6 }, color: [0.7, 0.3, 0.25] },
    ],
    targets: [
      { id: 't1', label: '1 号垛位', half: { x: 1.6, y: 0.25, z: 1.6 }, center: { x: 8.2, y: 0.25, z: 3.4 } },
      { id: 't2', label: '2 号垛位', half: { x: 1.6, y: 0.25, z: 1.6 }, center: { x: 8.2, y: 0.25, z: 0.2 } },
    ],
  },
  {
    id: 'ws-plate',
    label: '二车间 · 板材模具跨',
    travelX: [-13, 13],
    travelZ: [-7, 7],
    pivotY: 10.4,
    ropeMin: 1.4,
    ropeMax: 8.6,
    floorSize: [32, 20],
    timeLimit: 180,
    obstacles: [
      { id: 'table', label: '切割工作台', half: { x: 2.6, y: 0.9, z: 1.8 }, center: { x: -3.0, y: 0.9, z: 0.6 }, color: [0.35, 0.38, 0.42] },
      { id: 'rackp', label: '钢板货架', half: { x: 3.4, y: 2.2, z: 0.9 }, center: { x: 3.8, y: 2.2, z: -3.6 }, color: [0.45, 0.3, 0.22] },
      { id: 'moldrack', label: '模具存放区', half: { x: 1.8, y: 1.4, z: 1.8 }, center: { x: -8.4, y: 1.4, z: -4.6 }, color: [0.5, 0.4, 0.3] },
      { id: 'pillar1', label: '厂房立柱 1', half: { x: 0.4, y: 5, z: 0.4 }, center: { x: -6.5, y: 5, z: 5.4 }, color: [0.5, 0.5, 0.55] },
      { id: 'pillar2', label: '厂房立柱 2', half: { x: 0.4, y: 5, z: 0.4 }, center: { x: 6.8, y: 5, z: 5.4 }, color: [0.5, 0.5, 0.55] },
    ],
    targets: [
      { id: 't1', label: 'A 区垛位', half: { x: 3.4, y: 0.25, z: 1.7 }, center: { x: 10.2, y: 0.25, z: 4.6 } },
      { id: 't2', label: 'B 区垛位', half: { x: 2.0, y: 0.25, z: 2.0 }, center: { x: 10.2, y: 0.25, z: -1.8 } },
      { id: 't3', label: 'C 区垛位', half: { x: 2.0, y: 0.25, z: 2.0 }, center: { x: -10.4, y: 0.25, z: 2.2 } },
    ],
  },
];

export function getWorkshop(id: string): WorkshopSpec {
  const ws = WORKSHOPS.find((w) => w.id === id);
  if (!ws) throw new Error(`未知车间: ${id}`);
  return ws;
}

/** 各车间练习的起点（大车 X、小车 Z、初始绳长） */
export function getStartPose(workshopId: string): { x: number; z: number; rope: number } {
  if (workshopId === 'ws-coil') return { x: -8.2, z: 3.6, rope: 2.6 };
  return { x: -10.0, z: -5.4, rope: 3.0 };
}
