import { LOADS, WORKSHOPS } from './config';
import type { SessionResult } from './scoring';
import { clearSessions, loadSessions } from './storage';

export interface UIHooks {
  onStart(trainee: string, wsId: string, loadId: string): void;
  onGiveUp(): void;
  onRetry(): void;
  onExitToMenu(): void;
}

export interface HudData {
  swingRope: number;
  swingLoad: number;
  swingMax: number;
  ropeLen: number;
  vB: number;
  vT: number;
  vH: number;
  time: number;
  par: number;
  dedSwing: number;
  dedAlarm: number;
  dedTime: number;
  alarms: number;
  score: number;
  alarm: boolean;
  gamepad: string;
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error('missing #' + id);
  return e as T;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function swingClass(deg: number): string {
  return deg <= 5 ? 'swing-ok' : deg <= 10 ? 'swing-warn' : 'swing-bad';
}

export class UI {
  private selectedWs = WORKSHOPS[0].id;
  private selectedLoad = LOADS[0].id;
  private lastTextUpdate = 0;

  constructor(private hooks: UIHooks) {
    // 车间 / 吊物卡片
    const wsList = el('workshop-list');
    for (const w of WORKSHOPS) {
      const c = document.createElement('div');
      c.className = 'card' + (w.id === this.selectedWs ? ' selected' : '');
      c.innerHTML = `<div class="name">${esc(w.name)}</div><div class="meta">${esc(w.desc)}</div>`;
      c.onclick = () => {
        this.selectedWs = w.id;
        wsList.querySelectorAll('.card').forEach((x) => x.classList.remove('selected'));
        c.classList.add('selected');
      };
      wsList.appendChild(c);
    }
    const loadList = el('load-list');
    for (const l of LOADS) {
      const c = document.createElement('div');
      c.className = 'card' + (l.id === this.selectedLoad ? ' selected' : '');
      c.innerHTML = `<div class="name">${esc(l.name)}</div><div class="meta">${esc(l.desc)}</div>`;
      c.onclick = () => {
        this.selectedLoad = l.id;
        loadList.querySelectorAll('.card').forEach((x) => x.classList.remove('selected'));
        c.classList.add('selected');
      };
      loadList.appendChild(c);
    }

    const nameInp = el<HTMLInputElement>('inp-name');
    nameInp.value = localStorage.getItem('craneSim.trainee') ?? '';

    el<HTMLButtonElement>('btn-start').onclick = () => {
      const name = nameInp.value.trim() || '学员';
      localStorage.setItem('craneSim.trainee', name);
      hooks.onStart(name, this.selectedWs, this.selectedLoad);
    };
    el('btn-dashboard').onclick = () => this.showDashboard();
    el('btn-dash-back').onclick = () => this.showMenu();
    el('btn-dash-clear').onclick = () => {
      clearSessions();
      this.showDashboard();
    };
    el('btn-giveup').onclick = () => hooks.onGiveUp();
    el('btn-retry').onclick = () => hooks.onRetry();
    el('btn-tomenu').onclick = () => hooks.onExitToMenu();
    el('btn-end-dashboard').onclick = () => this.showDashboard();
  }

  private show(id: string): void {
    for (const s of ['menu', 'hud', 'endmodal', 'dashboard']) {
      el(s).classList.toggle('hidden', s !== id);
    }
  }

  showMenu(): void {
    this.show('menu');
  }

  showHUD(trainee: string, wsName: string, loadName: string): void {
    el('tb-trainee').textContent = `学员：${trainee}`;
    el('tb-scene').textContent = `${wsName} · ${loadName}`;
    this.show('hud');
  }

  tick(d: HudData): void {
    el('alarm-banner').classList.toggle('hidden', !d.alarm);
    const now = performance.now();
    if (now - this.lastTextUpdate < 100) return;
    this.lastTextUpdate = now;

    const setSwing = (id: string, v: number) => {
      const e = el(id);
      e.textContent = v.toFixed(1) + '°';
      e.className = swingClass(v);
    };
    setSwing('hud-swing-rope', d.swingRope);
    setSwing('hud-swing-load', d.swingLoad);
    setSwing('hud-swing-max', d.swingMax);
    el('hud-rope').textContent = d.ropeLen.toFixed(1) + ' m';
    el('hud-vb').textContent = d.vB.toFixed(2) + ' m/s';
    el('hud-vt').textContent = d.vT.toFixed(2) + ' m/s';
    el('hud-vh').textContent = d.vH.toFixed(2) + ' m/s';
    el('hud-time').textContent = d.time.toFixed(1) + ' s';
    el('hud-par').textContent = d.par + ' s';
    el('hud-ded-swing').textContent = '-' + d.dedSwing.toFixed(1);
    el('hud-ded-alarm').textContent = '-' + d.dedAlarm;
    el('hud-ded-time').textContent = '-' + d.dedTime;
    el('hud-alarms').textContent = String(d.alarms);
    el('hud-score').textContent = String(d.score);
    el('hud-pad').textContent = d.gamepad || '未连接';
  }

  showEnd(r: SessionResult): void {
    el('end-grade').textContent = r.grade;
    el('end-score').textContent = `${r.score} 分`;
    const cells: Array<[string, string]> = [
      ['结果', r.reason],
      ['最大摆角', r.maxSwing.toFixed(1) + '°'],
      ['用时', r.timeSec.toFixed(1) + ' s'],
      ['报警次数', String(r.alarms)],
      ['落点偏差', r.success ? r.placeErr.toFixed(2) + ' m' : '—'],
      ['摆角扣分', '-' + r.dedSwing.toFixed(1)],
      ['报警扣分', '-' + r.dedAlarm],
      ['超时扣分', '-' + r.dedTime],
      ['落点扣分', '-' + r.dedPlace],
    ];
    el('end-stats').innerHTML = cells
      .map(([k, v]) => `<div class="cell"><div class="k">${k}</div><div class="v">${v}</div></div>`)
      .join('');
    this.show('endmodal');
  }

  showDashboard(): void {
    const sessions = loadSessions().slice().reverse();

    // 按学员累计学时（上岗需满 20 小时）
    const byTrainee = new Map<string, { n: number; sec: number; coll: number; sumScore: number }>();
    for (const s of sessions) {
      const a = byTrainee.get(s.trainee) ?? { n: 0, sec: 0, coll: 0, sumScore: 0 };
      a.n++;
      a.sec += s.timeSec;
      a.coll += s.collisions;
      a.sumScore += s.score;
      byTrainee.set(s.trainee, a);
    }
    const REQUIRED_H = 20;
    const traineeHtml =
      byTrainee.size === 0
        ? ''
        : [...byTrainee.entries()]
            .map(([name, a]) => {
              const h = a.sec / 3600;
              const ok = h >= REQUIRED_H;
              return `<div class="sum-card"><div class="name">${esc(name)}` +
                ` <span class="${ok ? '' : 'worst'}">${h.toFixed(1)} / ${REQUIRED_H} 学时${ok ? ' ✓' : ''}</span></div>` +
                `训练 ${a.n} 次 · 平均 ${(a.sumScore / a.n).toFixed(0)} 分 · 碰撞 ${a.coll} 次</div>`;
            })
            .join('');

    // 按吊物聚合，找出事最多的
    const byLoad = new Map<string, { n: number; coll: number; alarms: number; sumScore: number; sumSwing: number }>();
    for (const s of sessions) {
      const a = byLoad.get(s.load) ?? { n: 0, coll: 0, alarms: 0, sumScore: 0, sumSwing: 0 };
      a.n++;
      a.coll += s.collisions;
      a.alarms += s.alarms;
      a.sumScore += s.score;
      a.sumSwing += s.maxSwing;
      byLoad.set(s.load, a);
    }
    let worst: string | null = null;
    let worstRate = -1;
    for (const [name, a] of byLoad) {
      const rate = a.coll / a.n;
      if (rate > worstRate) {
        worstRate = rate;
        worst = name;
      }
    }
    const summary = el('dash-summary');
    if (byLoad.size === 0) {
      summary.innerHTML = '<div class="sum-card">暂无训练记录</div>';
    } else {
      summary.innerHTML =
        traineeHtml +
        [...byLoad.entries()]
          .map(([name, a]) => {
            const badge = name === worst && a.coll > 0 ? ' <span class="worst">★ 最易出事</span>' : '';
            return `<div class="sum-card"><div class="name">${esc(name)}${badge}</div>` +
              `训练 ${a.n} 次 · 碰撞 ${a.coll} 次（${Math.round((a.coll / a.n) * 100)}%）<br>` +
              `平均得分 ${(a.sumScore / a.n).toFixed(0)} · 平均最大摆角 ${(a.sumSwing / a.n).toFixed(1)}° · 报警 ${a.alarms} 次</div>`;
          })
          .join('');
    }

    const tbody = el('dash-table').querySelector('tbody');
    if (tbody) {
      tbody.innerHTML = sessions
        .map((s) => {
          const d = new Date(s.date);
          const time = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          return `<tr class="${s.success ? '' : 'fail'}">` +
            `<td>${time}</td><td>${esc(s.trainee)}</td><td>${esc(s.workshop)}</td><td>${esc(s.load)}</td>` +
            `<td>${esc(s.grade)}</td><td>${s.score}</td><td>${s.maxSwing.toFixed(1)}°</td>` +
            `<td>${s.timeSec.toFixed(0)}s</td><td>${s.alarms}</td><td>${s.collisions}</td></tr>`;
        })
        .join('');
    }
    this.show('dashboard');
  }
}
