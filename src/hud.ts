import type { CraneSimulation, KinematicSnapshot } from './physics/simulation';
import { toDeg } from './physics/math3d';

export interface HudRefs {
  time: HTMLElement;
  swingHook: HTMLElement;
  swingLoad: HTMLElement;
  rope: HTMLElement;
  gap: HTMLElement;
  speed: HTMLElement;
  alarm: HTMLElement;
  status: HTMLElement;
  fps: HTMLElement;
  pauseHint: HTMLElement;
}

export function getHudRefs(root: ParentNode): HudRefs {
  const q = (id: string) => root.querySelector<HTMLElement>(id)!;
  return {
    time: q('#hud-time'),
    swingHook: q('#hud-hook-swing'),
    swingLoad: q('#hud-load-swing'),
    rope: q('#hud-rope'),
    gap: q('#hud-gap'),
    speed: q('#hud-speed'),
    alarm: q('#hud-alarm'),
    status: q('#hud-status'),
    fps: q('#hud-fps'),
    pauseHint: q('#pause-hint'),
  };
}

const SWING_LIMIT_DEG = 5;

export function updateHud(
  refs: HudRefs,
  sim: CraneSimulation,
  snap: KinematicSnapshot,
  alarm: boolean,
  minGap: number,
  fps: number,
  paused: boolean,
): void {
  refs.time.textContent = `${sim.metrics.elapsed.toFixed(1)} s`;
  const hookSwing = Math.max(Math.abs(snap.thetaHookX), Math.abs(snap.thetaHookZ));
  const loadSwing = Math.max(Math.abs(snap.thetaLoadX), Math.abs(snap.thetaLoadZ));
  refs.swingHook.textContent = `${toDeg(hookSwing).toFixed(1)}°`;
  refs.swingLoad.textContent = `${toDeg(loadSwing).toFixed(1)}°`;
  refs.swingLoad.classList.toggle('over', toDeg(loadSwing) > SWING_LIMIT_DEG);
  refs.rope.textContent = `${snap.rope.toFixed(2)} m`;
  refs.gap.textContent = Number.isFinite(minGap) ? `${minGap.toFixed(2)} m` : '—';
  refs.gap.classList.toggle('over', minGap < 0.5);
  const speed = Math.hypot(sim.vx, sim.vz);
  refs.speed.textContent = `${speed.toFixed(2)} m/s`;
  refs.fps.textContent = `${Math.round(fps)} FPS`;

  refs.alarm.hidden = !alarm;
  refs.pauseHint.hidden = !paused;

  if (sim.status === 'failed') {
    refs.status.textContent = `失败：${sim.metrics.finishReason ?? ''}`;
    refs.status.className = 'status-badge fail';
  } else if (sim.status === 'landed') {
    refs.status.textContent = '已安全落垛';
    refs.status.className = 'status-badge ok';
  } else {
    refs.status.textContent = paused ? '已暂停' : '作业中';
    refs.status.className = `status-badge ${paused ? 'pause' : 'run'}`;
  }
}
