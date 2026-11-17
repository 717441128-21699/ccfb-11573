import { describe, expect, it } from 'vitest';
import { scoreSession, statsByLoadKind, buildRecord } from './scoring';
import { CraneSimulation, type SimMetrics } from './physics/simulation';
import { getWorkshop } from './config';
import type { SessionConfig } from './types';

function blankMetrics(over: Partial<SimMetrics> = {}): SimMetrics {
  return {
    elapsed: 60,
    maxLoadSwingDeg: 3,
    maxHookSwingDeg: 2,
    swingOverLimitTime: 0,
    alarmCount: 0,
    alarmTime: 0,
    minGap: 2,
    collisionCount: 0,
    landingError: 0,
    landingSwingDeg: 2,
    finishReason: '安全落垛',
    ...over,
  };
}

const ws = getWorkshop('ws-coil');

describe('评分规则', () => {
  it('完美作业满分 100 评级优秀', () => {
    const r = scoreSession(blankMetrics(), 'landed', ws);
    expect(r.score).toBe(100);
    expect(r.grade).toBe('优秀');
    expect(r.passed).toBe(true);
  });

  it('碰撞失败直接 0 分不合格', () => {
    const r = scoreSession(blankMetrics({ finishReason: '碰撞障碍物：料架 A' }), 'failed', ws);
    expect(r.score).toBe(0);
    expect(r.grade).toBe('不合格');
    expect(r.deductions[0].label).toContain('碰撞');
  });

  it('摆角超限每秒扣 2 分，报警每次扣 3 分', () => {
    const r = scoreSession(
      blankMetrics({ swingOverLimitTime: 5, alarmCount: 2 }),
      'landed',
      ws,
    );
    expect(r.score).toBe(100 - 10 - 6);
  });

  it('超时每秒扣 1 分', () => {
    const r = scoreSession(blankMetrics({ elapsed: ws.timeLimit + 20 }), 'landed', ws);
    expect(r.score).toBe(80);
  });

  it('扣分有 0 分下限，评级分档正确', () => {
    const r = scoreSession(blankMetrics({ swingOverLimitTime: 1000, alarmCount: 50 }), 'landed', ws);
    expect(r.score).toBe(0);
    expect(r.grade).toBe('不合格');
  });

  it('按吊物类别聚合能识别高风险类别', () => {
    const config: SessionConfig = { workshopId: 'ws-coil', loadKind: 'coil', studentName: '张三' };
    const sim = new CraneSimulation(config);
    const records = [
      buildRecord(config, ws, blankMetrics({ collisionCount: 1 }), scoreSession(blankMetrics({ finishReason: 'x' }), 'failed', ws), new Date('2026-11-01T08:00:00Z')),
      buildRecord({ ...config, loadKind: 'plate' }, ws, blankMetrics(), scoreSession(blankMetrics(), 'landed', ws), new Date('2026-11-02T08:00:00Z')),
    ];
    const stats = statsByLoadKind(records);
    const coil = stats.find((s) => s.loadKind === 'coil')!;
    expect(coil.collisions).toBe(1);
    expect(coil.failRate).toBe(1);
    const plate = stats.find((s) => s.loadKind === 'plate')!;
    expect(plate.failRate).toBe(0);
  });
});
