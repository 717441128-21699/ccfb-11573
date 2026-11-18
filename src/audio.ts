/** 报警蜂鸣与结果音效（WebAudio，首次用户操作后启用） */
export class AudioFX {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private beepTimer: number | null = null;
  private beepOn = false;

  /** 需在用户手势中调用一次 */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setAlarm(on: boolean): void {
    if (on === this.beepOn) return;
    this.beepOn = on;
    if (on) {
      if (!this.ctx) return;
      if (!this.osc) {
        this.osc = this.ctx.createOscillator();
        this.osc.type = 'square';
        this.osc.frequency.value = 880;
        this.gain = this.ctx.createGain();
        this.gain.gain.value = 0;
        this.osc.connect(this.gain);
        this.gain.connect(this.ctx.destination);
        this.osc.start();
      }
      let high = false;
      const tick = () => {
        if (!this.gain || !this.ctx) return;
        high = !high;
        this.gain.gain.setTargetAtTime(high ? 0.06 : 0, this.ctx.currentTime, 0.01);
      };
      tick();
      this.beepTimer = window.setInterval(tick, 220);
    } else {
      if (this.beepTimer !== null) {
        clearInterval(this.beepTimer);
        this.beepTimer = null;
      }
      if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    }
  }

  /** 成功：两声上扬 */
  chime(): void {
    this.tone(660, 0, 0.15);
    this.tone(990, 0.18, 0.25);
  }

  /** 失败：低沉长音 */
  buzz(): void {
    this.tone(160, 0, 0.6, 'sawtooth');
  }

  private tone(freq: number, delay: number, dur: number, type: OscillatorType = 'sine'): void {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.08, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(this.ctx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
}
