import { describe, expect, it } from 'vitest';
import { createAxis, naturalFrequencies, stepAxis } from './pendulum';

const G = 9.81;

describe('双摆模型', () => {
  it('静止释放保持静止（无外力时不产生虚假摆动）', () => {
    const a = createAxis();
    for (let i = 0; i < 10000; i++) {
      stepAxis(a, { L1: 4, L1dot: 0, L2: 2, m1: 800, m2: 20000, pivotAcc: 0, dt: 0.001 });
    }
    expect(a.theta1).toBeCloseTo(0, 10);
    expect(a.theta2).toBeCloseTo(0, 10);
  });

  it('吊点突然加速后吊物向加速反方向摆（与实际天车起车现象一致）', () => {
    const a = createAxis();
    for (let i = 0; i < 200; i++) {
      stepAxis(a, { L1: 4, L1dot: 0, L2: 2, m1: 800, m2: 20000, pivotAcc: 0.5, dt: 0.001 });
    }
    expect(a.theta2).toBeLessThan(0);
    expect(a.theta1).toBeLessThan(0);
  });

  it('小角度慢模态周期随绳长增大而变长（绳放长摆动变慢）', () => {
    // 双摆存在快慢两个模态；吊钩角 theta1 以慢模态为主，用其过零测慢模态周期
    const measureSlowPeriod = (L1: number) => {
      const a = createAxis();
      a.theta1 = 0.05;
      const times: number[] = [];
      let prev = a.theta1;
      for (let i = 0; i < 300000 && times.length < 3; i++) {
        stepAxis(a, { L1, L1dot: 0, L2: 2, m1: 800, m2: 20000, pivotAcc: 0, dt: 0.001 });
        if (prev > 0 && a.theta1 <= 0) times.push(i * 0.001);
        prev = a.theta1;
      }
      return times[2] - times[0]; // 两个过零间隔 = 一个周期
    };
    const shortRope = measureSlowPeriod(2);
    const longRope = measureSlowPeriod(6);
    expect(longRope).toBeGreaterThan(shortRope);

    // 单摆极限（m1≫m2、L2→0 时耦合消失）：解析固有频率应趋近 √(g/L)
    const [wL2] = naturalFrequencies(2, 0.2, 50000, 1);
    const [wL6] = naturalFrequencies(6, 0.2, 50000, 1);
    expect(wL2).toBeCloseTo(Math.sqrt(G / 2), 1);
    expect(wL6).toBeCloseTo(Math.sqrt(G / 6), 1);
  });

  it('能量在阻尼意义下有界且摆幅不发散（数值稳定性）', () => {
    const a = createAxis();
    a.theta1 = 0.08;
    a.theta2 = -0.05;
    let maxAngle = 0;
    for (let i = 0; i < 60000; i++) {
      stepAxis(a, { L1: 5, L1dot: 0, L2: 2.5, m1: 900, m2: 22000, pivotAcc: 0, dt: 0.001 });
      maxAngle = Math.max(maxAngle, Math.abs(a.theta1), Math.abs(a.theta2));
    }
    expect(maxAngle).toBeLessThan(0.15);
  });

  it('放绳过程的科氏项：匀速放绳不会产生异常能量爆炸', () => {
    const a = createAxis();
    a.theta2 = 0.06;
    let L = 2;
    let maxAngle = 0;
    for (let i = 0; i < 100000; i++) {
      L = Math.min(7, L + 0.05 * 0.001);
      stepAxis(a, { L1: L, L1dot: 0.05, L2: 2, m1: 800, m2: 20000, pivotAcc: 0, dt: 0.001 });
      maxAngle = Math.max(maxAngle, Math.abs(a.theta1), Math.abs(a.theta2));
    }
    expect(maxAngle).toBeLessThan(0.3);
  });

  it('固有频率随绳长增大而降低', () => {
    const [w1Short, w2Short] = naturalFrequencies(2, 2, 800, 20000);
    const [w1Long, w2Long] = naturalFrequencies(6, 2, 800, 20000);
    expect(w1Long).toBeLessThan(w1Short);
    expect(w2Long).toBeLessThan(w2Short);
    // 单摆极限下频率应趋近 √(g/L)
    const [wSimple] = naturalFrequencies(2, 0.2, 50000, 1);
    expect(wSimple).toBeCloseTo(Math.sqrt(G / 2), 1);
    // 双摆两模态满足 w1 < √(g/L1) < w2 的数量级关系
    expect(w1Short).toBeLessThan(Math.sqrt(G / 2));
    expect(w2Short).toBeGreaterThan(Math.sqrt(G / 2));
  });

  it('跟车稳钩：吊点沿吊物摆速同向加速可减小摆幅（老司机稳钩手法）', () => {
    // 先制造一个摆动
    const seed = createAxis();
    for (let i = 0; i < 300; i++) {
      stepAxis(seed, { L1: 4, L1dot: 0, L2: 2, m1: 800, m2: 20000, pivotAcc: 0.4, dt: 0.001 });
    }
    const uncontrolled = createAxis();
    Object.assign(uncontrolled, seed);
    const controlled = createAxis();
    Object.assign(controlled, seed);

    // 控制组：吊点加速度与吊物摆速同向（跟车），限幅模拟机构能力
    for (let i = 0; i < 8000; i++) {
      const acc = Math.max(-0.5, Math.min(0.5, controlled.omega2 * 1.2));
      stepAxis(controlled, { L1: 4, L1dot: 0, L2: 2, m1: 800, m2: 20000, pivotAcc: acc, dt: 0.001 });
      stepAxis(uncontrolled, { L1: 4, L1dot: 0, L2: 2, m1: 800, m2: 20000, pivotAcc: 0, dt: 0.001 });
    }
    expect(Math.abs(controlled.theta2)).toBeLessThan(Math.abs(uncontrolled.theta2));
  });
});
