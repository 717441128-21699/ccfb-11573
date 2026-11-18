// 向量与矩阵工具（列主序 Mat4，直接喂给 WebGL）

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export function len(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function dist2D(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

export type Mat4 = Float32Array; // 16 元素，列主序

export function mat4Perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function mat4LookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  let zx = eye.x - center.x, zy = eye.y - center.y, zz = eye.z - center.z;
  const zl = Math.hypot(zx, zy, zz) || 1e-6;
  zx /= zl; zy /= zl; zz /= zl;
  let xx = up.y * zz - up.z * zy;
  let xy = up.z * zx - up.x * zz;
  let xz = up.x * zy - up.y * zx;
  const xl = Math.hypot(xx, xy, xz) || 1e-6;
  xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx;
  m[4] = xy; m[5] = yy; m[6] = zy;
  m[8] = xz; m[9] = yz; m[10] = zz;
  m[12] = -(xx * eye.x + xy * eye.y + xz * eye.z);
  m[13] = -(yx * eye.x + yy * eye.y + yz * eye.z);
  m[14] = -(zx * eye.x + zy * eye.y + zz * eye.z);
  m[15] = 1;
  return m;
}

/** 平移 + 绕 Y 旋转 + 缩放 的组合矩阵 */
export function mat4TRS(
  px: number, py: number, pz: number,
  ry: number,
  sx: number, sy: number, sz: number,
): Mat4 {
  const c = Math.cos(ry), s = Math.sin(ry);
  const m = new Float32Array(16);
  m[0] = c * sx; m[2] = -s * sx;
  m[5] = sy;
  m[8] = s * sz; m[10] = c * sz;
  m[12] = px; m[13] = py; m[14] = pz;
  m[15] = 1;
  return m;
}

/** 生成把单位圆柱（y∈[-0.5,0.5]，半径1）放到 a→b 线段上、半径 r 的矩阵 */
export function mat4Between(a: Vec3, b: Vec3, r: number): Mat4 {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const l = Math.hypot(dx, dy, dz) || 1e-6;
  const yx = dx / l, yy = dy / l, yz = dz / l;
  let hx = 0, hy = 1, hz = 0;
  if (Math.abs(yy) > 0.99) { hx = 1; hy = 0; hz = 0; }
  // x = normalize(cross(helper, y))
  let xx = hy * yz - hz * yy;
  let xy = hz * yx - hx * yz;
  let xz = hx * yy - hy * yx;
  const xl = Math.hypot(xx, xy, xz) || 1e-6;
  xx /= xl; xy /= xl; xz /= xl;
  // z = cross(x, y)
  const zx = xy * yz - xz * yy;
  const zy = xz * yx - xx * yz;
  const zz = xx * yy - xy * yx;
  const m = new Float32Array(16);
  m[0] = xx * r; m[1] = xy * r; m[2] = xz * r;
  m[4] = yx * l; m[5] = yy * l; m[6] = yz * l;
  m[8] = zx * r; m[9] = zy * r; m[10] = zz * r;
  m[12] = (a.x + b.x) / 2; m[13] = (a.y + b.y) / 2; m[14] = (a.z + b.z) / 2;
  m[15] = 1;
  return m;
}
