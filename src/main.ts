import './styles.css';
import { WORKSHOPS, LOADS } from './config';
import type { SessionConfig, LoadKind } from './types';
import { CraneSimulation, PHYSICS_DT } from './physics/simulation';
import { WebGLRenderer } from './render/renderer';
import { CraneScene, OrbitCamera } from './render/scene';
import { InputManager } from './input';
import { getHudRefs, updateHud, type HudRefs } from './hud';
import { buildRecord, loadRecords, saveRecord, scoreSession, statsByLoadKind, statsByStudent, clearRecords, REQUIRED_TRAINING_SECONDS, type SessionRecord } from './scoring';

type Screen = 'setup' | 'sim' | 'result' | 'coach';

class App {
  private screen: Screen = 'setup';
  private sim: CraneSimulation | null = null;
  private renderer: WebGLRenderer | null = null;
  private scene: CraneScene | null = null;
  private camera: OrbitCamera | null = null;
  private input: InputManager | null = null;
  private hud: HudRefs | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private raf = 0;
  private lastTime = 0;
  private accumulator = 0;
  private paused = false;
  private fps = 60;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private sessionStart = new Date();
  private lastRecord: SessionRecord | null = null;
  private followCamera = false;

  constructor() {
    this.bindSetup();
    this.bindCoach();
    this.bindSimChrome();
    this.showScreen('setup');
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  private $(id: string): HTMLElement {
    return document.querySelector<HTMLElement>(id)!;
  }

  private showScreen(name: Screen) {
    this.screen = name;
    for (const s of ['setup', 'sim', 'result', 'coach'] as const) {
      this.$(`#screen-${s}`).classList.toggle('active', s === name);
    }
    if (name === 'coach') this.renderCoach();
  }

  // ---------- 配置页 ----------

  private bindSetup() {
    const wsBox = this.$('#workshop-options');
    WORKSHOPS.forEach((ws, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option-btn' + (i === 0 ? ' selected' : '');
      btn.dataset.value = ws.id;
      btn.innerHTML = `<strong>${ws.label}</strong><span>时限 ${ws.timeLimit} s · 障碍 ${ws.obstacles.length} 处 · 垛位 ${ws.targets.length} 个</span>`;
      wsBox.appendChild(btn);
    });
    const loadBox = this.$('#load-options');
    (Object.keys(LOADS) as LoadKind[]).forEach((kind, i) => {
      const l = LOADS[kind];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option-btn' + (i === 0 ? ' selected' : '');
      btn.dataset.value = kind;
      btn.innerHTML = `<strong>${l.label}</strong><span>${(l.mass / 1000).toFixed(1)} t · 吊点长 ${l.slingLength.toFixed(1)} m</span>`;
      loadBox.appendChild(btn);
    });

    document.querySelectorAll('.option-group').forEach((group) => {
      group.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('.option-btn') as HTMLElement | null;
        if (!btn) return;
        group.querySelectorAll('.option-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });

    this.$('#btn-start').addEventListener('click', () => this.startSession());
    this.$('#btn-coach').addEventListener('click', () => this.showScreen('coach'));
  }

  private selectedValue(groupId: string): string {
    return (this.$(groupId).querySelector('.option-btn.selected') as HTMLElement).dataset.value!;
  }

  private startSession() {
    const name = (this.$('#student-name') as HTMLInputElement).value.trim() || '未命名学员';
    const config: SessionConfig = {
      workshopId: this.selectedValue('#workshop-options'),
      loadKind: this.selectedValue('#load-options') as LoadKind,
      studentName: name,
    };
    this.sessionStart = new Date();
    this.sim = new CraneSimulation(config);
    this.paused = false;
    this.accumulator = 0;
    this.showScreen('sim');
    this.initWebGL();
    this.$('#sim-title').textContent = `${this.sim.studentName} · ${this.sim.workshop.label} · ${this.sim.load.label}`;
    this.$('#target-label').textContent = `目标：${this.sim.target.label}（${this.sim.target.center.x.toFixed(1)}, ${this.sim.target.center.z.toFixed(1)}）`;
  }

  // ---------- 仿真页 ----------

  private initWebGL() {
    if (!this.sim) return;
    this.canvas = this.$('#gl-canvas') as HTMLCanvasElement;
    if (!this.renderer) {
      this.renderer = new WebGLRenderer(this.canvas);
      this.input = new InputManager();
      this.input.bindTouchButtons(this.$('#touch-controls'));
      this.input.onPause = () => this.togglePause();
      this.hud = getHudRefs(document);
    }
    this.scene = new CraneScene(this.renderer, this.sim.workshop, this.sim.load);
    this.camera = new OrbitCamera(this.canvas);
    this.camera.setFollow(this.followCamera);
    this.resizeCanvas();
    this.lastTime = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
  }

  private bindSimChrome() {
    this.$('#btn-pause').addEventListener('click', () => this.togglePause());
    this.$('#btn-abort').addEventListener('click', () => this.abortSession());
    this.$('#btn-camera').addEventListener('click', () => {
      this.followCamera = !this.followCamera;
      this.camera?.setFollow(this.followCamera);
      this.$('#btn-camera').textContent = this.followCamera ? '视角：跟随' : '视角：全局';
    });
  }

  private togglePause() {
    if (this.sim && this.sim.status === 'running') this.paused = !this.paused;
  }

  private abortSession() {
    cancelAnimationFrame(this.raf);
    if (this.sim && this.sim.status === 'running') {
      (this.sim as unknown as { status: string }).status = 'failed';
      this.sim.metrics.finishReason = '学员主动中止';
      this.finishSession();
    } else {
      this.showScreen('setup');
    }
  }

  private resizeCanvas() {
    if (!this.canvas || !this.renderer) return;
    const rect = this.canvas.getBoundingClientRect();
    this.renderer.resize(rect.width || 800, rect.height || 600);
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.sim || !this.renderer || !this.scene || !this.camera || !this.hud || !this.input) return;

    let frame = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (frame > 0.1) frame = 0.1; // 切后台回来不追帧爆炸

    // 固定 1ms 物理步长累加器
    if (!this.paused && this.sim.status === 'running') {
      this.accumulator += frame;
      let guard = 0;
      while (this.accumulator >= PHYSICS_DT && guard < 400) {
        this.sim.step(this.input.sample());
        this.accumulator -= PHYSICS_DT;
        guard++;
      }
      if (this.sim.status !== 'running') {
        this.finishSession();
        return;
      }
    }

    // FPS 统计
    this.fpsAccum += frame;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    const alpha = this.accumulator / PHYSICS_DT;
    const snap = this.sim.getRenderState(alpha);
    const alarmState = CraneScene.evaluateAlarm(snap, this.sim.load, this.sim.workshop);
    this.camera.followTarget(snap.load);
    const rect = this.canvas!.getBoundingClientRect();
    this.renderer.resize(rect.width, rect.height);
    this.renderer.setViewProj(this.camera.viewProj(rect.width / Math.max(1, rect.height)), this.camera.position);
    this.scene.update(snap, alarmState.alarm, this.sim.status === 'failed');
    this.renderer.render();

    updateHud(this.hud, this.sim, snap, alarmState.alarm, alarmState.minGap, this.fps, this.paused);
  };

  private finishSession() {
    cancelAnimationFrame(this.raf);
    if (!this.sim) return;
    const sim = this.sim;
    const score = scoreSession(sim.metrics, sim.status === 'landed' ? 'landed' : 'failed', sim.workshop);
    const record = buildRecord(
      { workshopId: sim.workshop.id, loadKind: sim.load.kind, studentName: sim.studentName },
      sim.workshop,
      sim.metrics,
      score,
      this.sessionStart,
    );
    saveRecord(record);
    this.lastRecord = record;
    this.renderResult(record, score.deductions);
    this.showScreen('result');
  }

  // ---------- 成绩单页 ----------

  private renderResult(record: SessionRecord, deductions: { label: string; points: number }[]) {
    const box = this.$('#result-body');
    const dHtml = deductions.length
      ? deductions.map((d) => `<li><span>${d.label}</span><b>-${d.points}</b></li>`).join('')
      : '<li><span>无扣分点</span><b>0</b></li>';
    box.innerHTML = `
      <div class="result-head ${record.passed ? 'ok' : 'fail'}">
        <div class="score-num">${record.score}</div>
        <div>
          <div class="grade">${record.grade}</div>
          <div class="reason">${record.finishReason ?? ''}</div>
        </div>
      </div>
      <ul class="metric-grid">
        <li><span>用时</span><b>${record.durationSec} s</b></li>
        <li><span>吊物最大摆角</span><b>${record.maxLoadSwingDeg}°</b></li>
        <li><span>超 5° 时长</span><b>${record.swingOverLimitTime} s</b></li>
        <li><span>报警次数</span><b>${record.alarmCount}</b></li>
        <li><span>碰撞次数</span><b>${record.collisionCount}</b></li>
        <li><span>最小净距</span><b>${record.minGap ?? '—'} m</b></li>
        <li><span>落点偏差</span><b>${record.landingError} m</b></li>
        <li><span>吊物 / 车间</span><b>${record.loadLabel} / ${record.workshopLabel}</b></li>
      </ul>
      <h4>扣分明细</h4>
      <ul class="deduction-list">${dHtml}</ul>`;
    this.$('#btn-retry').onclick = () => this.startSession();
    this.$('#btn-home').onclick = () => this.showScreen('setup');
    this.$('#btn-to-coach').onclick = () => this.showScreen('coach');
  }

  // ---------- 教练端 ----------

  private bindCoach() {
    this.$('#btn-coach-back').addEventListener('click', () => this.showScreen('setup'));
    this.$('#btn-export').addEventListener('click', () => this.exportCsv());
    this.$('#btn-clear').addEventListener('click', () => {
      if (confirm('确认清空全部学员成绩单？此操作不可恢复。')) {
        clearRecords();
        this.renderCoach();
      }
    });
    this.$('#coach-filter').addEventListener('change', () => this.renderCoach());
  }

  private renderCoach() {
    const records = loadRecords();
    const filter = (this.$('#coach-filter') as HTMLSelectElement | null)?.value ?? 'all';
    const rows = filter === 'all' ? records : records.filter((r) => r.studentName === filter);

    const names = [...new Set(records.map((r) => r.studentName))];
    const select = this.$('#coach-filter') as HTMLSelectElement;
    if (select && select.options.length - 1 !== names.length) {
      select.innerHTML = '<option value="all">全部学员</option>' + names.map((n) => `<option value="${n}">${n}</option>`).join('');
      select.value = filter;
    }

    // 按吊物类别统计：哪类最容易出事
    const kindStats = statsByLoadKind(rows);
    this.$('#coach-kind-stats').innerHTML = kindStats.length
      ? `<table><thead><tr><th>吊物</th><th>次数</th><th>碰撞</th><th>报警</th><th>平均最大摆角</th><th>失败率</th><th>平均分</th></tr></thead>
        <tbody>${kindStats.map((s) => `<tr><td>${s.loadLabel}</td><td>${s.sessions}</td><td class="${s.collisions ? 'bad' : ''}">${s.collisions}</td><td>${s.alarms}</td><td>${s.avgMaxSwing}°</td><td class="${s.failRate > 0 ? 'bad' : ''}">${(s.failRate * 100).toFixed(0)}%</td><td>${s.avgScore}</td></tr>`).join('')}</tbody></table>`
      : '<p class="empty">暂无数据</p>';

    // 学员训练时长（20 小时门槛）
    const studentStats = statsByStudent(rows);
    this.$('#coach-student-stats').innerHTML = studentStats.length
      ? `<table><thead><tr><th>学员</th><th>练习次数</th><th>累计训练时长</th><th>距 20 h</th><th>平均分</th><th>失败次数</th><th>上岗资格</th></tr></thead>
        <tbody>${studentStats.map((s) => {
          const remain = Math.max(0, (REQUIRED_TRAINING_SECONDS / 3600) - s.trainingHours);
          return `<tr><td>${s.studentName}</td><td>${s.sessions}</td><td>${s.trainingHours.toFixed(2)} h</td><td>${remain.toFixed(2)} h</td><td>${s.avgScore}</td><td class="${s.failures ? 'bad' : ''}">${s.failures}</td><td>${s.qualified ? '<span class="ok-tag">达标</span>' : '<span class="no-tag">未达标</span>'}</td></tr>`;
        }).join('')}</tbody></table>`
      : '<p class="empty">暂无数据</p>';

    // 逐次成绩单
    this.$('#coach-records').innerHTML = rows.length
      ? `<table><thead><tr><th>时间</th><th>学员</th><th>车间</th><th>吊物</th><th>用时</th><th>最大摆角</th><th>报警</th><th>碰撞</th><th>分数</th><th>评级</th><th>结果</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${new Date(r.startedAt).toLocaleString('zh-CN', { hour12: false })}</td><td>${r.studentName}</td><td>${r.workshopLabel}</td><td>${r.loadLabel}</td><td>${r.durationSec}s</td><td>${r.maxLoadSwingDeg}°</td><td>${r.alarmCount}</td><td class="${r.collisionCount ? 'bad' : ''}">${r.collisionCount}</td><td><b>${r.score}</b></td><td>${r.grade}</td><td>${r.passed ? '<span class="ok-tag">通过</span>' : '<span class="no-tag">失败</span>'}</td></tr>`).join('')}</tbody></table>`
      : '<p class="empty">暂无成绩单，先完成一次模拟练习。</p>';
  }

  private exportCsv() {
    const records = loadRecords();
    if (records.length === 0) return;
    const header = ['时间', '学员', '车间', '吊物', '用时s', '最大摆角', '超限时长s', '报警', '碰撞', '最小净距m', '落点偏差m', '分数', '评级', '结果', '结束原因'];
    const lines = records.map((r) => [
      new Date(r.startedAt).toLocaleString('zh-CN', { hour12: false }),
      r.studentName, r.workshopLabel, r.loadLabel, r.durationSec, r.maxLoadSwingDeg,
      r.swingOverLimitTime, r.alarmCount, r.collisionCount, r.minGap ?? '', r.landingError,
      r.score, r.grade, r.passed ? '通过' : '失败', r.finishReason ?? '',
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob(['﻿' + [header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `天车模拟成绩单_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

new App();
