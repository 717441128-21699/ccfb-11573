import type { SessionResult } from './scoring';

const KEY = 'craneSim.sessions.v1';

export function loadSessions(): SessionResult[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as SessionResult[]) : [];
  } catch {
    return [];
  }
}

export function saveSession(s: SessionResult): void {
  try {
    const all = loadSessions();
    all.push(s);
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // 存储满或被禁用时静默失败，不影响训练
  }
}

export function clearSessions(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
