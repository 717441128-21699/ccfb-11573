/**
 * 双摆模型（单轴，小角度线性化）
 *
 * 物理结构：天车小车/大车为运动吊点 P，下挂两级摆——
 *   第一级：钢丝绳 + 吊钩组，摆长 L1、等效质量 m1（吊钩/夹钳质量）
 *   第二级：吊索 + 吊物，摆长 L2、质量 m2（吊物质量）
 * θ1 为吊钩相对铅垂线摆角，θ2 为吊物相对铅垂线摆角（均为绝对角）。
 *
 * 线性化拉格朗日方程（吊点加速度 ax 作为强迫项）：
 *   M(L) · [α1 α2]ᵀ = f(θ, ax) − Ṁ(L)·[ω1 ω2]ᵀ
 * 其中 Ṁω 项在 L 变化时自然给出 2L̇ω 科氏加速度（与单摆
 * θ̈ + 2L̇/L·θ̇ + g/L·θ = −ax/L 的标准形式一致），
 * 绳放长 → 频率 √(g/L) 降低 → 摆动周期变长。
 */

export interface PendulumAxis {
  /** 吊钩摆角 rad（相对铅垂线） */
  theta1: number;
  omega1: number;
  /** 吊物摆角 rad（相对铅垂线） */
  theta2: number;
  omega2: number;
}

export interface AxisStepParams {
  /** 第一级摆长（钢丝绳长度）m */
  L1: number;
  /** 绳长变化率 m/s，放绳为正 */
  L1dot: number;
  /** 第二级摆长（吊索等效长度）m，固定 */
  L2: number;
  /** 吊钩组质量 kg */
  m1: number;
  /** 吊物质量 kg */
  m2: number;
  /** 吊点水平加速度 m/s² */
  pivotAcc: number;
  /** 步长 s */
  dt: number;
}

const G = 9.81;
/**
 * 综合阻尼系数（空气阻力 + 绳组/机构摩擦的等效线性阻尼）：
 * 阻尼力矩 = DAMPING × Mii × ω，自由摆动包络时间常数约 1/DAMPING ≈ 12.5 s，
 * 与真实天车吊重自由摆动十几秒明显衰减的经验一致；又不至于把可训练的摆动迅速吃掉。
 */
const DAMPING = 0.08;

export function createAxis(): PendulumAxis {
  return { theta1: 0, omega1: 0, theta2: 0, omega2: 0 };
}

/**
 * 推进一个时间步（半隐式欧拉：先解角加速度，再更新角速度、角度）。
 * 直接原地修改并返回 state。
 */
export function stepAxis(state: PendulumAxis, p: AxisStepParams): PendulumAxis {
  const { L1, L1dot, L2, m1, m2, pivotAcc, dt } = p;

  // 质量矩阵 M（当前绳长下冻结）
  const M11 = (m1 + m2) * L1 * L1;
  const M12 = m2 * L1 * L2;
  const M22 = m2 * L2 * L2;

  // 重力 + 吊点加速度的广义力
  const f1 = -(m1 + m2) * L1 * (G * state.theta1 + pivotAcc);
  const f2 = -m2 * L2 * (G * state.theta2 + pivotAcc);

  // Ṁ：绳长变化引起的质量矩阵变化（L2 固定，L2dot = 0）
  const Mdot11 = 2 * (m1 + m2) * L1 * L1dot;
  const Mdot12 = m2 * L1dot * L2;
  const Mdot22 = 0;

  // 右端项：f − Ṁω，再叠加微弱空气阻尼
  const b1 = f1 - Mdot11 * state.omega1 - Mdot12 * state.omega2 - DAMPING * M11 * state.omega1;
  const b2 = f2 - Mdot12 * state.omega1 - Mdot22 * state.omega2 - DAMPING * M22 * state.omega2;

  // 2×2 求解，det = m1·m2·L1²·L2²，m1>0 时恒不为零
  const det = M11 * M22 - M12 * M12;
  const alpha1 = (b1 * M22 - M12 * b2) / det;
  const alpha2 = (M11 * b2 - M12 * b1) / det;

  // 半隐式欧拉
  state.omega1 += alpha1 * dt;
  state.omega2 += alpha2 * dt;
  state.theta1 += state.omega1 * dt;
  state.theta2 += state.omega2 * dt;
  return state;
}

/** 小角度近似下，吊钩相对吊点的水平偏移 */
export function hookOffset(axis: PendulumAxis, L1: number): number {
  return L1 * Math.sin(axis.theta1);
}

/** 小角度近似下，吊物相对吊钩的水平偏移 */
export function loadOffset(axis: PendulumAxis, L2: number): number {
  return L2 * Math.sin(axis.theta2);
}

/**
 * 线性化模型的两个固有角频率（rad/s），用于教学提示与测试。
 * 特征值：M⁻¹K，K = diag((m1+m2)L1·g, m2 L2·g)
 */
export function naturalFrequencies(L1: number, L2: number, m1: number, m2: number): [number, number] {
  const M11 = (m1 + m2) * L1 * L1;
  const M12 = m2 * L1 * L2;
  const M22 = m2 * L2 * L2;
  const K11 = (m1 + m2) * L1 * G;
  const K22 = m2 * L2 * G;
  const det = M11 * M22 - M12 * M12;
  // M⁻¹K 的迹与行列式
  const a = M22 / det;
  const b = -M12 / det;
  const c = -M12 / det;
  const d = M11 / det;
  const A = a * K11;
  const B = b * K22;
  const C = c * K11;
  const D = d * K22;
  const tr = A + D;
  const detMK = A * D - B * C;
  const disc = Math.max(0, tr * tr - 4 * detMK);
  const w1 = Math.sqrt((tr - Math.sqrt(disc)) / 2);
  const w2 = Math.sqrt((tr + Math.sqrt(disc)) / 2);
  return [w1, w2];
}
