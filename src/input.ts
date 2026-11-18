import type { Cmd } from './physics';

const DEADZONE = 0.15;

function dz(v: number): number {
  return Math.abs(v) < DEADZONE ? 0 : v;
}

/** 键盘 + 手柄输入，合并为机构指令 */
export class Input {
  private keys = new Set<string>();
  gamepadName = '';

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  poll(): Cmd {
    const k = this.keys;
    let b = 0;
    let t = 0;
    let h = 0;
    let inch = k.has('ShiftLeft') || k.has('ShiftRight');

    if (k.has('KeyA') || k.has('ArrowLeft')) b -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) b += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) t -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) t += 1;
    if (k.has('KeyR') || k.has('PageUp')) h += 1;
    if (k.has('KeyF') || k.has('PageDown')) h -= 1;

    // 手柄（标准映射）
    this.gamepadName = '';
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      this.gamepadName = p.id.slice(0, 24);
      b += dz(p.axes[0] ?? 0);
      t += dz(p.axes[1] ?? 0);
      h -= dz(p.axes[3] ?? 0); // 右摇杆上推 = 上升
      const lt = p.buttons[6]?.value ?? 0;
      const rt = p.buttons[7]?.value ?? 0;
      h += rt - lt; // RT 升 / LT 降
      if (p.buttons[4]?.pressed) inch = true;
      break;
    }

    return {
      b: clamp1(b),
      t: clamp1(t),
      h: clamp1(h),
      inch,
    };
  }
}

function clamp1(v: number): number {
  return Math.max(-1, Math.min(1, v));
}
