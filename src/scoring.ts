export interface SessionResult {
  id: string;
  date: string;       // ISO 时间
  trainee: string;
  workshop: string;   // 车间名
  load: string;       // 吊物名
  success: boolean;
  reason: string;     // 完成 / 碰撞 / 放弃
  score: number;
  grade: string;
  maxSwing: number;   // 度
  timeSec: number;
  alarms: number;
  collisions: number;
  placeErr: number;   // 落点偏差 m
  dedSwing: number;
  dedAlarm: number;
  dedTime: number;
  dedPlace: number;
}

/**
 * 评分规则：
 *  - 摆角持续超过 5°：每秒扣 1.5 分，上限 40
 *  - 每次进入 0.5m 报警区：扣 3 分
 *  - 超过标准用时：每 10 秒扣 1 分，上限 15
 *  - 落点偏差：每 0.1m 扣 1 分，上限 10
 *  - 碰撞：直接判失败，0 分
 */
export class Scorer {
  time = 0;
  maxSwing = 0;
  alarms = 0;
  private overTime = 0; // 摆角>5° 的累计秒数
  private inAlarm = false;

  constructor(public readonly parTime: number) {}

  update(dt: number, swingMaxDeg: number, alarm: boolean): void {
    this.time += dt;
    if (swingMaxDeg > this.maxSwing) this.maxSwing = swingMaxDeg;
    if (swingMaxDeg > 5) this.overTime += dt;
    if (alarm && !this.inAlarm) this.alarms++;
    this.inAlarm = alarm;
  }

  get dedSwing(): number {
    return Math.min(40, this.overTime * 1.5);
  }

  get dedAlarm(): number {
    return this.alarms * 3;
  }

  get dedTime(): number {
    const over = this.time - this.parTime;
    return over <= 0 ? 0 : Math.min(15, Math.floor(over / 10));
  }

  get liveScore(): number {
    return Math.max(0, Math.round(100 - this.dedSwing - this.dedAlarm - this.dedTime));
  }

  finish(o: {
    trainee: string;
    workshop: string;
    load: string;
    success: boolean;
    collided: boolean;
    placeErr: number;
  }): SessionResult {
    const dedPlace = o.success ? Math.min(10, Math.round(o.placeErr * 10)) : 0;
    let score = Math.max(
      0,
      Math.round(100 - this.dedSwing - this.dedAlarm - this.dedTime - dedPlace),
    );
    let grade: string;
    let reason: string;
    if (o.collided) {
      score = 0;
      grade = '不合格（碰撞）';
      reason = '碰撞';
    } else if (!o.success) {
      grade = '不合格（未完成）';
      reason = '放弃';
    } else {
      reason = '完成';
      if (score >= 90) grade = '优秀';
      else if (score >= 75) grade = '良好';
      else if (score >= 60) grade = '合格';
      else grade = '不合格';
    }
    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date: new Date().toISOString(),
      trainee: o.trainee,
      workshop: o.workshop,
      load: o.load,
      success: o.success,
      reason,
      score,
      grade,
      maxSwing: Math.round(this.maxSwing * 10) / 10,
      timeSec: Math.round(this.time * 10) / 10,
      alarms: this.alarms,
      collisions: o.collided ? 1 : 0,
      placeErr: Math.round(o.placeErr * 100) / 100,
      dedSwing: Math.round(this.dedSwing * 10) / 10,
      dedAlarm: this.dedAlarm,
      dedTime: this.dedTime,
      dedPlace,
    };
  }
}
