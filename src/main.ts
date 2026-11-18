import { getLoad, getWorkshop, type LoadSpec, type WorkshopSpec } from './config';
import { Input } from './input';
import { AudioFX } from './audio';
import { dist2D } from './math';
import { Simulation } from './physics';
import { Renderer } from './render';
import { drawWorld } from './scene';
import { Scorer } from './scoring';
import { saveSession } from './storage';
import { UI } from './ui';

const DT = 0.001; // 物理步长 1ms
const MAX_STEPS = 120; // 每帧最多补偿 120ms，防螺旋

type State = 'menu' | 'running' | 'ended';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
let renderer: Renderer;
try {
  renderer = new Renderer(canvas);
} catch {
  document.getElementById('gl-error')?.classList.remove('hidden');
  throw new Error('WebGL2 unavailable');
}

const input = new Input();
const audio = new AudioFX();

let state: State = 'menu';
let sim: Simulation | null = null;
let scorer: Scorer | null = null;
let ws: WorkshopSpec = getWorkshop('rolling');
let loadSpec: LoadSpec = getLoad('coil');
let trainee = '学员';
let curWsId = ws.id;
let curLoadId = loadSpec.id;

// ---------- 视角鼠标控制 ----------
let dragging = false;
let lastX = 0;
let lastY = 0;
canvas.addEventListener('mousedown', (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});
window.addEventListener('mouseup', () => (dragging = false));
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const cam = renderer.camera;
  cam.yaw += (e.clientX - lastX) * 0.006;
  cam.pitch = Math.min(1.45, Math.max(0.12, cam.pitch + (e.clientY - lastY) * 0.004));
  lastX = e.clientX;
  lastY = e.clientY;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const cam = renderer.camera;
  cam.dist = Math.min(70, Math.max(8, cam.dist * (1 + e.deltaY * 0.001)));
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyC') renderer.camera.follow = !renderer.camera.follow;
});

// ---------- 训练流程 ----------
function startRun(name: string, wsId: string, loadId: string): void {
  trainee = name;
  curWsId = wsId;
  curLoadId = loadId;
  ws = getWorkshop(wsId);
  loadSpec = getLoad(loadId);
  sim = new Simulation(ws, loadSpec);
  const dist = dist2D(ws.start.x, ws.start.z, ws.target.x, ws.target.z);
  const par = Math.round((dist / 0.7) * 1.5 + 25);
  scorer = new Scorer(par);
  renderer.camera.target = { x: ws.start.x, y: 2, z: ws.start.z };
  renderer.camera.follow = true;
  state = 'running';
  ui.showHUD(trainee, ws.name, loadSpec.name);
}

function endRun(success: boolean, collided: boolean): void {
  if (!sim || !scorer) return;
  const placeErr = dist2D(sim.loadP.x, sim.loadP.z, ws.target.x, ws.target.z);
  const result = scorer.finish({
    trainee,
    workshop: ws.name,
    load: loadSpec.name,
    success,
    collided,
    placeErr,
  });
  saveSession(result);
  state = 'ended';
  audio.setAlarm(false);
  if (collided) audio.buzz();
  else if (success) audio.chime();
  ui.showEnd(result);
}

const ui = new UI({
  onStart: (name, wsId, loadId) => {
    audio.unlock();
    startRun(name, wsId, loadId);
  },
  onGiveUp: () => endRun(false, false),
  onRetry: () => startRun(trainee, curWsId, curLoadId),
  onExitToMenu: () => {
    state = 'menu';
    sim = null;
    audio.setAlarm(false);
    ui.showMenu();
  },
});
ui.showMenu();

// ---------- 主循环 ----------
let last = performance.now();
let acc = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;

  if (state === 'running' && sim && scorer) {
    acc += dt;
    const cmd = input.poll();
    let steps = 0;
    while (acc >= DT && steps < MAX_STEPS) {
      sim.step(DT, cmd);
      const swing = sim.swingDeg();
      scorer.update(DT, swing.max, sim.alarm);
      acc -= DT;
      steps++;
      if (sim.collision) break;
    }
    if (acc > DT * MAX_STEPS) acc = 0; // 掉帧严重时丢弃积压

    if (sim.collision) {
      endRun(false, true);
    } else {
      // 成功判定：吊物落稳在垛位内、摆角足够小
      const swing = sim.swingDeg();
      const dist = dist2D(sim.loadP.x, sim.loadP.z, ws.target.x, ws.target.z);
      if (sim.resting && sim.loadSpeed < 0.05 && swing.load < 3 && dist <= ws.target.r) {
        endRun(true, false);
      }
    }
    audio.setAlarm(state === 'running' && sim.alarm);
  }

  // 渲染
  const focus = sim ? sim.loadP : { x: 0, y: 2, z: 0 };
  renderer.begin(focus);
  drawWorld(renderer, {
    sim,
    ws,
    alarm: state === 'running' && !!sim?.alarm,
    timeMs: now,
  });

  // HUD
  if (state === 'running' && sim && scorer) {
    const swing = sim.swingDeg();
    ui.tick({
      swingRope: swing.rope,
      swingLoad: swing.load,
      swingMax: scorer.maxSwing,
      ropeLen: sim.ropeLen,
      vB: sim.vB,
      vT: sim.vT,
      vH: sim.vH,
      time: scorer.time,
      par: scorer.parTime,
      dedSwing: scorer.dedSwing,
      dedAlarm: scorer.dedAlarm,
      dedTime: scorer.dedTime,
      alarms: scorer.alarms,
      score: scorer.liveScore,
      alarm: sim.alarm,
      gamepad: input.gamepadName,
    });
  }
}

requestAnimationFrame(frame);
