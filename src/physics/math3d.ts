import type { Vec3, AABB } from '../types';

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x));

/** 两 AABB 是否重叠（接触即算碰撞） */
export function aabbOverlap(a: AABB, b: AABB): boolean {
  return (
    a.min.x < b.max.x && a.max.x > b.min.x &&
    a.min.y < b.max.y && a.max.y > b.min.y &&
    a.min.z < b.max.z && a.max.z > b.min.z
  );
}

/** 两 AABB 表面最小间距；重叠时返回 0。仅对“分离”的轴计入距离，重叠轴贡献 0 */
export function aabbGap(a: AABB, b: AABB): number {
  const dx = gap1(a.min.x, a.max.x, b.min.x, b.max.x);
  const dy = gap1(a.min.y, a.max.y, b.min.y, b.max.y);
  const dz = gap1(a.min.z, a.max.z, b.min.z, b.max.z);
  if (dx <= 0 || dy <= 0 || dz <= 0) {
    // 任一轴重叠：表面距离由其余分离轴决定（全部重叠则为 0）
    const px = Math.max(0, dx);
    const py = Math.max(0, dy);
    const pz = Math.max(0, dz);
    return Math.hypot(px, py, pz);
  }
  return Math.hypot(dx, dy, dz);
}

function gap1(amin: number, amax: number, bmin: number, bmax: number): number {
  if (amax <= bmin) return bmin - amax;
  if (bmax <= amin) return amin - bmax;
  return 0;
}

/** 以 center 为中心、half 为半尺寸构造 AABB */
export function makeAABB(center: Vec3, half: Vec3): AABB {
  return {
    center: { ...center },
    min: { x: center.x - half.x, y: center.y - half.y, z: center.z - half.z },
    max: { x: center.x + half.x, y: center.y + half.y, z: center.z + half.z },
  };
}

/** 弧度 -> 度 */
export const toDeg = (rad: number): number => (rad * 180) / Math.PI;

// ---------- 4x4 列主序矩阵（WebGL 直接可用） ----------

export type Mat4 = Float32Array;

export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

export function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

export function mat4Translation(t: Vec3): Mat4 {
  const m = mat4Identity();
  m[12] = t.x; m[13] = t.y; m[14] = t.z;
  return m;
}

export function mat4Scale(s: Vec3): Mat4 {
  const m = mat4Identity();
  m[0] = s.x; m[5] = s.y; m[10] = s.z;
  return m;
}

/**
 * 构造局部 +Y 轴对齐到 dir 的模型矩阵（用于钢丝绳 / 吊索等倾斜圆柱）。
 * 原点为圆柱中点，scale.y 沿绳方向，scale.x/z 为粗细。
 */
export function mat4AlignY(origin: Vec3, dir: Vec3, sc: Vec3): Mat4 {
  const y = norm(dir);
  const helper = Math.abs(y.y) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const x = norm(cross(helper, y));
  const z = cross(x, y);
  const m = mat4Identity();
  m[0] = x.x * sc.x; m[1] = x.y * sc.x; m[2] = x.z * sc.x;
  m[4] = y.x * sc.y; m[5] = y.y * sc.y; m[6] = y.z * sc.y;
  m[8] = z.x * sc.z; m[9] = z.y * sc.z; m[10] = z.z * sc.z;
  m[12] = origin.x; m[13] = origin.y; m[14] = origin.z;
  return m;
}

/** 右手系透视投影，fovy 为弧度 */
export function mat4Perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function mat4LookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  const m = mat4Identity();
  m[0] = x.x; m[1] = y.x; m[2] = z.x;
  m[4] = x.y; m[5] = y.y; m[6] = z.y;
  m[8] = x.z; m[9] = y.z; m[10] = z.z;
  m[12] = -dot(x, eye);
  m[13] = -dot(y, eye);
  m[14] = -dot(z, eye);
  return m;
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}
