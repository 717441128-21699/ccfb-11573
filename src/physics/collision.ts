import type { AABB, Obstacle, Vec3 } from '../types';
import { aabbGap, aabbOverlap, makeAABB } from './math3d';

/** 报警距离：小于 0.5 m 报警 */
export const ALARM_GAP = 0.5;

export interface CollisionResult {
  /** 是否发生硬碰撞（碰上即失败） */
  hit: boolean;
  /** 最小净距 m（与所有障碍物中的最小值） */
  minGap: number;
  /** 净距小于 0.5 m 的障碍物标签列表 */
  nearLabels: string[];
  /** 发生碰撞的障碍物标签 */
  hitLabel: string | null;
}

const NO_CONTACT: CollisionResult = { hit: false, minGap: Infinity, nearLabels: [], hitLabel: null };

/** 用当前吊物中心与半尺寸生成碰撞盒（保守按 AABB，不按摆角旋转） */
export function loadBox(center: Vec3, half: Vec3): AABB {
  return makeAABB(center, half);
}

export function checkCollisions(box: AABB, obstacles: Obstacle[]): CollisionResult {
  if (obstacles.length === 0) return NO_CONTACT;
  let minGap = Infinity;
  const nearLabels: string[] = [];
  let hitLabel: string | null = null;

  for (const o of obstacles) {
    const ob = makeAABB(o.center, o.half);
    if (aabbOverlap(box, ob)) {
      hitLabel = o.label;
      return { hit: true, minGap: 0, nearLabels: [o.label], hitLabel };
    }
    const gap = aabbGap(box, ob);
    if (gap < minGap) minGap = gap;
    if (gap < ALARM_GAP) nearLabels.push(o.label);
  }
  return { hit: false, minGap, nearLabels, hitLabel: null };
}

/** 与车间行程边界（两侧立柱墙）的最小净距，越界即硬碰撞 */
export function checkBounds(box: AABB, xRange: [number, number], zRange: [number, number]): { hit: boolean; label: string | null } {
  if (box.min.x < xRange[0] || box.max.x > xRange[1]) return { hit: true, label: '大车行程极限' };
  if (box.min.z < zRange[0] || box.max.z > zRange[1]) return { hit: true, label: '小车行程极限' };
  return { hit: false, label: null };
}
