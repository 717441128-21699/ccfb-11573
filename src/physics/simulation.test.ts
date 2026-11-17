import { describe, expect, it } from 'vitest';
import { CraneSimulation } from './simulation';
import type { SessionConfig } from '../types';

const baseConfig: SessionConfig = { workshopId: 'ws-coil', loadKind: 'coil', studentName: '测试学员' };

function runSteps(sim: CraneSimulation, steps: number, cmd = { gantry: 0, trolley: 0, hoist: 0 }) {
  for (let i = 0; i < steps && sim.status === 'running'; i++) sim.step(cmd);
}

function runSeconds(sim: CraneSimulation, seconds: number, cmd = { gantry: 0, trolley: 0, hoist: 0 }) {
  runSteps(sim, Math.round(seconds / 0.001), cmd);
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

describe('天车仿真集成', () => {
  it('初始状态吊物在起点正下方静止', () => {
    const sim = new CraneSimulation(baseConfig);
    runSeconds(sim, 2);
    expect(sim.axisX.theta2).toBeCloseTo(0, 6);
    expect(sim.axisZ.theta2).toBeCloseTo(0, 6);
    expect(sim.status).toBe('running');
  });

  it('大车起车后吊物出现摆动，停车后摆角被计入峰值', () => {
    const sim = new CraneSimulation(baseConfig);
    runSeconds(sim, 2.5, { gantry: 1, trolley: 0, hoist: 0 });
    runSeconds(sim, 8, { gantry: 0, trolley: 0, hoist: 0 });
    expect(sim.metrics.maxLoadSwingDeg).toBeGreaterThan(5);
    expect(sim.metrics.maxLoadSwingDeg).toBeLessThan(20);
  });

  it('放绳使绳长增加并受最大值约束', () => {
    const sim = new CraneSimulation(baseConfig);
    const startRope = sim.rope;
    runSeconds(sim, 20, { gantry: 0, trolley: 0, hoist: 1 });
    expect(sim.rope).toBeGreaterThan(startRope);
    expect(sim.rope).toBeLessThanOrEqual(sim.workshop.ropeMax);
  });

  it('放长钢丝绳后摆动物理周期变长（同一激励下慢模态更慢）', () => {
    const measure = (targetRope: number) => {
      const sim = new CraneSimulation(baseConfig);
      // 先把绳放到指定长度
      while (sim.rope < targetRope - 0.01 && sim.status === 'running') {
        sim.step({ gantry: 0, trolley: 0, hoist: 1 });
      }
      expect(sim.status).toBe('running');
      runSeconds(sim, 2, { gantry: 1, trolley: 0, hoist: 0 });
      runSeconds(sim, 1, { gantry: 0, trolley: 0, hoist: 0 });
      // 测量吊钩角后续两次过零间隔
      let prev = sim.axisX.theta1;
      const zeros: number[] = [];
      for (let i = 0; i < 80000 && zeros.length < 3 && sim.status === 'running'; i++) {
        sim.step({ gantry: 0, trolley: 0, hoist: 0 });
        if (prev > 0 && sim.axisX.theta1 <= 0) zeros.push(i);
        prev = sim.axisX.theta1;
      }
      expect(zeros.length).toBe(3);
      return (zeros[2] - zeros[0]) * 0.001;
    };
    // 起点附近安全可达的绳长区间：短绳 2.6（初始）与放绳后的 4.0
    expect(measure(4.0)).toBeGreaterThan(measure(2.6));
  });

  it('撞向障碍物直接判失败且碰撞次数至少为 1', () => {
    const sim = new CraneSimulation(baseConfig);
    // 起点 (-8.2, 3.6)，待处理钢卷堆中心 (-7.5, 3.2)、半宽 1.4；放绳后向 +X 行进必撞
    runSeconds(sim, 8, { gantry: 0, trolley: 0, hoist: 1 });
    runSeconds(sim, 30, { gantry: 1, trolley: 0, hoist: 0 });
    expect(sim.status).toBe('failed');
    expect(sim.metrics.collisionCount).toBeGreaterThanOrEqual(1);
    expect(sim.metrics.finishReason).toContain('碰撞');
  });

  it('摆角超 5° 累计超限时间（最大加速度起停即可触发）', () => {
    const sim = new CraneSimulation(baseConfig);
    runSeconds(sim, 2.5, { gantry: 1, trolley: 0, hoist: 0 });
    runSeconds(sim, 6, { gantry: 0, trolley: 0, hoist: 0 });
    expect(sim.metrics.swingOverLimitTime).toBeGreaterThan(0);
  });

  it('0.5m 报警在接近障碍物时触发且先于碰撞', () => {
    const sim = new CraneSimulation(baseConfig);
    // 防护桩位于起点小车正前方（x=-8.2、z=0.6，与高位吊物同高），
    // 小车沿 -Z 直行时净距连续缩小：应先进入 0.5m 报警区，继续逼近才硬碰撞
    const bollard = sim.workshop.obstacles.find((o) => o.id === 'bollard')!;
    expect(bollard).toBeDefined();
    let sawAlarmBeforeHit = false;
    for (let i = 0; i < 12000 && sim.status === 'running'; i++) {
      sim.step({ gantry: 0, trolley: -0.3, hoist: 0 });
      if (sim.metrics.alarmCount > 0) sawAlarmBeforeHit = true;
    }
    expect(sawAlarmBeforeHit).toBe(true);
    expect(sim.status).toBe('failed');
    expect(sim.metrics.alarmCount).toBeGreaterThan(0);
    expect(sim.metrics.collisionCount).toBeGreaterThan(0);
  });

  it('渲染插值快照在两个物理快照之间', () => {
    const sim = new CraneSimulation(baseConfig);
    runSteps(sim, 50, { gantry: 1, trolley: 0, hoist: 0 });
    const s0 = sim.getRenderState(0);
    const s1 = sim.getRenderState(1);
    const sm = sim.getRenderState(0.5);
    expect(sm.pivot.x).toBeGreaterThan(s0.pivot.x);
    expect(sm.pivot.x).toBeLessThan(s1.pivot.x);
  });

  it('完整脚本化作业可安全落垛：定位稳钩 -> 消摆 -> 带稳钩落钩', () => {
    const sim = new CraneSimulation(baseConfig);
    const target = sim.target;

    // 阶段 1：位置 P 反馈 + 吊钩摆角反馈（工业防摇结构），每物理步重算
    for (let i = 0; i < 25000 && sim.status === 'running'; i++) {
      const l = sim.loadPosition();
      sim.step({
        gantry: clamp1((target.center.x - l.x) * 0.15 + sim.axisX.theta1 * 0.4),
        trolley: clamp1((target.center.z - l.z) * 0.15 + sim.axisZ.theta1 * 0.4),
        hoist: 0,
      });
    }
    // 阶段 2：停车自然消摆
    runSeconds(sim, 35, { gantry: 0, trolley: 0, hoist: 0 });
    expect(Math.max(Math.abs(sim.axisX.theta2), Math.abs(sim.axisZ.theta2)) * 180 / Math.PI).toBeLessThan(5);

    // 阶段 3：落钩同时保持弱位置修正（老司机落钩点动跟车）
    for (let i = 0; i < 60000 && sim.status === 'running'; i++) {
      const l = sim.loadPosition();
      sim.step({
        gantry: clamp1((target.center.x - l.x) * 0.12 + sim.axisX.theta1 * 0.3),
        trolley: clamp1((target.center.z - l.z) * 0.12 + sim.axisZ.theta1 * 0.3),
        hoist: 0.4,
      });
    }
    expect(sim.status).toBe('landed');
    expect(sim.metrics.landingError).toBeLessThan(0.4);
    expect(sim.metrics.landingSwingDeg).toBeLessThan(5);
  });
});
