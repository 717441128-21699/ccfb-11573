import { describe, expect, it } from 'vitest';
import { checkBounds, checkCollisions, loadBox, ALARM_GAP } from './collision';
import type { Obstacle } from '../types';

const obstacle: Obstacle = {
  id: 'o1', label: '料架', half: { x: 1, y: 1, z: 1 }, center: { x: 5, y: 1, z: 0 },
  color: [0, 0, 0],
};

describe('碰撞与报警', () => {
  it('重叠即硬碰撞', () => {
    const box = loadBox({ x: 5.5, y: 1, z: 0 }, { x: 1, y: 1, z: 1 });
    const r = checkCollisions(box, [obstacle]);
    expect(r.hit).toBe(true);
    expect(r.hitLabel).toBe('料架');
  });

  it('净距小于 0.5m 触发报警但不算碰撞', () => {
    // 障碍 max.x = 6；吊物 min.x = 6.4 时净距 0.4（中心 7.4、半宽 1）
    const box = loadBox({ x: 7.4, y: 1, z: 0 }, { x: 1, y: 1, z: 1 });
    const r = checkCollisions(box, [obstacle]);
    expect(r.hit).toBe(false);
    expect(r.minGap).toBeCloseTo(0.4, 5);
    expect(r.nearLabels).toContain('料架');
    expect(ALARM_GAP).toBe(0.5);
  });

  it('净距大于 0.5m 无报警', () => {
    const box = loadBox({ x: 10, y: 1, z: 0 }, { x: 1, y: 1, z: 1 });
    const r = checkCollisions(box, [obstacle]);
    expect(r.hit).toBe(false);
    expect(r.nearLabels).toHaveLength(0);
  });

  it('超出大车/小车行程判碰撞', () => {
    const box = loadBox({ x: 20, y: 2, z: 0 }, { x: 1, y: 1, z: 1 });
    expect(checkBounds(box, [-11, 11], [-5, 5]).hit).toBe(true);
    const ok = loadBox({ x: 0, y: 2, z: 0 }, { x: 1, y: 1, z: 1 });
    expect(checkBounds(ok, [-11, 11], [-5, 5]).hit).toBe(false);
  });
});
