import type { Vec3 } from './math';

export type LoadShape = 'coil' | 'plate' | 'mold';

export interface LoadSpec {
  id: string;
  name: string;
  mass: number;       // 吊物质量 kg
  hookMass: number;   // 吊钩/吊具质量 kg
  rigLen: number;     // 吊钩到吊物质心的索具长度 m（第二级摆长）
  size: Vec3;         // 吊物外形尺寸 m（用于 AABB 碰撞与绘制）
  shape: LoadShape;
  color: [number, number, number];
  desc: string;
}

export interface Obstacle {
  min: Vec3;
  max: Vec3;
  name: string;
}

export interface WorkshopSpec {
  id: string;
  name: string;
  desc: string;
  size: { x: number; z: number }; // 车间长(x) × 宽(z)，米
  craneHeight: number;            // 小车(吊点)高度，米
  obstacles: Obstacle[];
  start: { x: number; z: number };
  target: { x: number; z: number; r: number }; // 垛位中心与允许半径
}

export const LOADS: LoadSpec[] = [
  {
    id: 'coil',
    name: '钢卷',
    mass: 25000,
    hookMass: 800,          // C 型钩，自重大
    rigLen: 1.4,
    size: { x: 1.8, y: 1.8, z: 1.6 },
    shape: 'coil',
    color: [0.55, 0.6, 0.68],
    desc: '25t · C型钩单点吊 · 重心低、惯性大，起停容易悠',
  },
  {
    id: 'plate',
    name: '钢板',
    mass: 12000,
    hookMass: 300,
    rigLen: 2.6,            // 四腿链条，吊点高
    size: { x: 6.0, y: 0.12, z: 2.0 },
    shape: 'plate',
    color: [0.5, 0.56, 0.62],
    desc: '12t · 四腿链条 · 6m 长件，回转半径大最易刮碰',
  },
  {
    id: 'mold',
    name: '模具',
    mass: 8000,
    hookMass: 250,
    rigLen: 1.8,
    size: { x: 1.6, y: 1.2, z: 1.3 },
    shape: 'mold',
    color: [0.62, 0.5, 0.38],
    desc: '8t · 四点吊 · 贵重件，轻拿轻放',
  },
];

function rack(cx: number, cz: number, sx: number, sy: number, sz: number, name: string): Obstacle {
  return {
    min: { x: cx - sx / 2, y: 0, z: cz - sz / 2 },
    max: { x: cx + sx / 2, y: sy, z: cz + sz / 2 },
    name,
  };
}

export const WORKSHOPS: WorkshopSpec[] = [
  {
    id: 'rolling',
    name: '轧钢车间',
    desc: '60m×24m · 两排料架，通道较宽，适合入门',
    size: { x: 60, z: 24 },
    craneHeight: 9,
    obstacles: [
      // 北侧料架排（z 4~6.5）
      rack(-18, 5.25, 8, 2.4, 2.5, '料架A1'),
      rack(-6, 5.25, 8, 2.4, 2.5, '料架A2'),
      rack(6, 5.25, 8, 2.4, 2.5, '料架A3'),
      rack(18, 5.25, 8, 2.4, 2.5, '料架A4'),
      // 南侧料架排（z -6.5~-4）
      rack(-12, -5.25, 8, 2.4, 2.5, '料架B1'),
      rack(0, -5.25, 8, 2.4, 2.5, '料架B2'),
      rack(12, -5.25, 8, 2.4, 2.5, '料架B3'),
      // 设备基础
      rack(26, -2, 3, 1.6, 3, '设备基础'),
    ],
    start: { x: -25, z: -8 },
    target: { x: 24, z: 8, r: 1.2 },
  },
  {
    id: 'moldshop',
    name: '模具车间',
    desc: '40m×20m · 工作台密集，净空小，考验微动',
    size: { x: 40, z: 20 },
    craneHeight: 8,
    obstacles: [
      rack(-10, 2, 4, 1.1, 3, '工作台1'),
      rack(-3, -3, 4, 1.1, 3, '工作台2'),
      rack(4, 3, 4, 1.1, 3, '工作台3'),
      rack(10, -2, 4, 1.1, 3, '工作台4'),
      rack(-14, -5, 3, 3.0, 2, '模具架1'),
      rack(14, 5, 3, 3.0, 2, '模具架2'),
      rack(0, 7, 10, 0.8, 2, '装配线'),
    ],
    start: { x: -15, z: 6 },
    target: { x: 14, z: -6, r: 1.0 },
  },
  {
    id: 'finish',
    name: '精整车间',
    desc: '50m×22m · 高垛位多，必须吊高越过或绕柱',
    size: { x: 50, z: 22 },
    craneHeight: 9,
    obstacles: [
      rack(-15, 0, 6, 3.2, 4, '高垛1'),
      rack(-5, 5, 6, 3.2, 4, '高垛2'),
      rack(5, -5, 6, 3.2, 4, '高垛3'),
      rack(15, 0, 6, 3.2, 4, '高垛4'),
      rack(0, 0, 2, 4.5, 2, '立柱1'),
      rack(-10, -6, 2, 4.5, 2, '立柱2'),
      rack(10, 6, 2, 4.5, 2, '立柱3'),
    ],
    start: { x: -20, z: 7 },
    target: { x: 20, z: -7, r: 1.0 },
  },
];

export function getWorkshop(id: string): WorkshopSpec {
  return WORKSHOPS.find((w) => w.id === id) ?? WORKSHOPS[0];
}

export function getLoad(id: string): LoadSpec {
  return LOADS.find((l) => l.id === id) ?? LOADS[0];
}
