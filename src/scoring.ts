import type { LoadKind, SessionConfig, WorkshopSpec } from './types';
import type { SimMetrics } from './physics/simulation';

/** 5° 摆角红线 */
export const SWING_LIMIT_DEG = 5;

export interface ScoreResult {
  passed: boolean;
  score: number;
  grade: '优秀' | '良好' | '合格' | '不合格';
  deductions: { label: string; points: number }[];
}

/**
 * 评分规则（满分 100）：
 * - 碰上障碍物/边界：直接判失败（0 分）
 * - 吊物摆角超 5°：每秒扣 2 分（按超限时长）
 * - 超时：每秒扣 1 分
 * - 0.5 m 报警：每次扣 3 分
 * - 落点偏差：每 0.1 m 扣 2 分
 * - 落地摆角：超出 5° 的部分每度扣 2 分
 */
export function scoreSession(
  metrics: SimMetrics,
  status: 'landed' | 'failed',
  workshop: WorkshopSpec,
): ScoreResult {
  const deductions: { label: string; points: number }[] = [];

  if (status === 'failed') {
    return {
      passed: false,
      score: 0,
      grade: '不合格',
      deductions: [{ label: metrics.finishReason ?? '操作失败', points: 100 }],
    };
  }

  if (metrics.swingOverLimitTime > 0) {
    deductions.push({
      label: `摆角超 5°（${metrics.swingOverLimitTime.toFixed(1)} s）`,
      points: round1(metrics.swingOverLimitTime * 2),
    });
  }

  const overtime = Math.max(0, metrics.elapsed - workshop.timeLimit);
  if (overtime > 0) {
    deductions.push({ label: `超时（${overtime.toFixed(1)} s）`, points: round1(overtime * 1) });
  }

  if (metrics.alarmCount > 0) {
    deductions.push({ label: `距障碍物不足 0.5 m 报警 ×${metrics.alarmCount}`, points: metrics.alarmCount * 3 });
  }

  if (metrics.landingError > 0) {
    deductions.push({
      label: `落点偏差 ${metrics.landingError.toFixed(2)} m`,
      points: round1((metrics.landingError / 0.1) * 2),
    });
  }

  const landingOver = Math.max(0, metrics.landingSwingDeg - SWING_LIMIT_DEG);
  if (landingOver > 0) {
    deductions.push({
      label: `落地摆角 ${metrics.landingSwingDeg.toFixed(1)}°`,
      points: round1(landingOver * 2),
    });
  }

  const total = deductions.reduce((s, d) => s + d.points, 0);
  const score = Math.max(0, Math.round(100 - total));
  return { passed: true, score, grade: gradeOf(score), deductions };
}

function gradeOf(score: number): ScoreResult['grade'] {
  if (score >= 90) return '优秀';
  if (score >= 75) return '良好';
  if (score >= 60) return '合格';
  return '不合格';
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** 一条学员成绩单记录 */
export interface SessionRecord {
  id: string;
  studentName: string;
  workshopId: string;
  workshopLabel: string;
  loadKind: LoadKind;
  loadLabel: string;
  startedAt: string;
  durationSec: number;
  score: number;
  grade: string;
  passed: boolean;
  maxLoadSwingDeg: number;
  swingOverLimitTime: number;
  alarmCount: number;
  collisionCount: number;
  minGap: number;
  landingError: number;
  finishReason: string | null;
  /** 本次有效训练时长（s），用于累计 20 小时上岗要求 */
  trainingSeconds: number;
}

const STORAGE_KEY = 'crane-sim-records-v1';

export function saveRecord(record: SessionRecord): void {
  const all = loadRecords();
  all.unshift(record);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function loadRecords(): SessionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SessionRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function clearRecords(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function buildRecord(
  config: SessionConfig,
  workshop: WorkshopSpec,
  metrics: SimMetrics,
  score: ScoreResult,
  startedAt: Date,
): SessionRecord {
  return {
    id: `${startedAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    studentName: config.studentName,
    workshopId: workshop.id,
    workshopLabel: workshop.label,
    loadKind: config.loadKind,
    loadLabel: { coil: '钢卷', plate: '钢板', mold: '模具' }[config.loadKind],
    startedAt: startedAt.toISOString(),
    durationSec: Math.round(metrics.elapsed * 10) / 10,
    score: score.score,
    grade: score.grade,
    passed: score.passed,
    maxLoadSwingDeg: Math.round(metrics.maxLoadSwingDeg * 10) / 10,
    swingOverLimitTime: Math.round(metrics.swingOverLimitTime * 10) / 10,
    alarmCount: metrics.alarmCount,
    collisionCount: metrics.collisionCount,
    minGap: metrics.minGap === Infinity ? null as unknown as number : Math.round(metrics.minGap * 100) / 100,
    landingError: Math.round(metrics.landingError * 100) / 100,
    finishReason: metrics.finishReason,
    trainingSeconds: Math.round(metrics.elapsed),
  };
}

export interface LoadKindStat {
  loadKind: LoadKind;
  loadLabel: string;
  sessions: number;
  collisions: number;
  alarms: number;
  avgMaxSwing: number;
  failRate: number;
  avgScore: number;
}

/** 按吊物类别聚合：看哪类吊物最容易出事 */
export function statsByLoadKind(records: SessionRecord[]): LoadKindStat[] {
  const labels: Record<LoadKind, string> = { coil: '钢卷', plate: '钢板', mold: '模具' };
  const kinds: LoadKind[] = ['coil', 'plate', 'mold'];
  return kinds
    .map((kind) => {
      const rows = records.filter((r) => r.loadKind === kind);
      const n = rows.length;
      if (n === 0) {
        return { loadKind: kind, loadLabel: labels[kind], sessions: 0, collisions: 0, alarms: 0, avgMaxSwing: 0, failRate: 0, avgScore: 0 };
      }
      const sum = (f: (r: SessionRecord) => number) => rows.reduce((s, r) => s + f(r), 0);
      return {
        loadKind: kind,
        loadLabel: labels[kind],
        sessions: n,
        collisions: sum((r) => r.collisionCount),
        alarms: sum((r) => r.alarmCount),
        avgMaxSwing: round2(sum((r) => r.maxLoadSwingDeg) / n),
        failRate: round2(rows.filter((r) => !r.passed).length / n),
        avgScore: round2(sum((r) => r.score) / n),
      };
    })
    .filter((s) => s.sessions > 0);
}

/** 按学员汇总训练时长（20 小时 = 72000 s 上岗门槛） */
export interface StudentStat {
  studentName: string;
  sessions: number;
  trainingHours: number;
  qualified: boolean;
  avgScore: number;
  failures: number;
}

export const REQUIRED_TRAINING_SECONDS = 20 * 3600;

export function statsByStudent(records: SessionRecord[]): StudentStat[] {
  const map = new Map<string, SessionRecord[]>();
  for (const r of records) {
    const list = map.get(r.studentName) ?? [];
    list.push(r);
    map.set(r.studentName, list);
  }
  return [...map.entries()].map(([name, rows]) => {
    const seconds = rows.reduce((s, r) => s + r.trainingSeconds, 0);
    return {
      studentName: name,
      sessions: rows.length,
      trainingHours: round2(seconds / 3600),
      qualified: seconds >= REQUIRED_TRAINING_SECONDS,
      avgScore: round2(rows.reduce((s, r) => s + r.score, 0) / rows.length),
      failures: rows.filter((r) => !r.passed).length,
    };
  });
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
