import type { DriveCommand } from './physics/simulation';

const DEADZONE = 0.15;

/**
 * 统一输入：
 * - 键盘：A/D（或 ←/→）大车，W/S（或 ↑/↓）小车，Q 起升 / E 下降，P 暂停
 * - 标准手柄：左摇杆大车/小车，LT 起升 / RT 下降，肩键备用
 * - 触屏按钮：页面上的 data-dir 按钮（平板训练用）
 */
export class InputManager {
  private keys = new Set<string>();
  private touch: DriveCommand = { gantry: 0, trolley: 0, hoist: 0 };
  private touchActive = new Set<string>();
  onPause: (() => void) | null = null;
  private keyHandler: (e: KeyboardEvent) => void;
  private keyUpHandler: (e: KeyboardEvent) => void;

  constructor() {
    this.keyHandler = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
      if (k === 'p' && e.type === 'keydown' && !e.repeat) this.onPause?.();
      this.keys.add(k);
    };
    this.keyUpHandler = (e: KeyboardEvent) => {
      this.keys.delete(e.key.toLowerCase());
    };
    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('keyup', this.keyUpHandler);
  }

  /** 绑定触屏按钮：元素需带 data-dir = gantry+ / gantry- / trolley+ / trolley- / hoist+ / hoist- */
  bindTouchButtons(root: HTMLElement): void {
    const buttons = root.querySelectorAll<HTMLElement>('[data-dir]');
    buttons.forEach((btn) => {
      const dir = btn.dataset.dir!;
      const on = (e: Event) => {
        e.preventDefault();
        this.touchActive.add(dir);
      };
      const off = (e: Event) => {
        e.preventDefault();
        this.touchActive.delete(dir);
      };
      btn.addEventListener('pointerdown', on);
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointercancel', off);
      btn.addEventListener('pointerleave', off);
    });
  }

  private keyboardCommand(): DriveCommand {
    const k = this.keys;
    const gantry = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const trolley = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    // E = 放绳下降（+），Q = 起升（-）
    const hoist = (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0);
    return { gantry, trolley, hoist };
  }

  private gamepadCommand(): DriveCommand | null {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = pads.find((p) => p !== null);
    if (!pad) return null;
    const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : v);
    const gantry = dz(pad.axes[0] ?? 0);
    const trolley = dz(pad.axes[1] ?? 0);
    // 标准映射：LT = buttons[6]，RT = buttons[7]，值 0..1
    const lt = pad.buttons[6]?.value ?? 0;
    const rt = pad.buttons[7]?.value ?? 0;
    let hoist = rt - lt;
    // 扳机不可用时退回肩键
    if (hoist === 0) hoist = (pad.buttons[5]?.pressed ? 1 : 0) - (pad.buttons[4]?.pressed ? 1 : 0);
    return { gantry, trolley, hoist };
  }

  /** 每帧调用，取得当前归一化驱动指令；手柄优先，其次键盘，最后触屏 */
  sample(): DriveCommand {
    const gp = this.gamepadCommand();
    if (gp && (gp.gantry !== 0 || gp.trolley !== 0 || gp.hoist !== 0)) return gp;
    const kb = this.keyboardCommand();
    if (kb.gantry !== 0 || kb.trolley !== 0 || kb.hoist !== 0) return kb;

    const t: DriveCommand = { gantry: 0, trolley: 0, hoist: 0 };
    for (const dir of this.touchActive) {
      const [axis, sign] = dir.split(/([+-])/).filter(Boolean);
      const s = sign === '+' ? 1 : -1;
      if (axis === 'gantry') t.gantry += s;
      if (axis === 'trolley') t.trolley += s;
      if (axis === 'hoist') t.hoist += s;
    }
    this.touch = t;
    return t;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('keyup', this.keyUpHandler);
  }
}
