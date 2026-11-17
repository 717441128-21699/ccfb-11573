import type { WorkshopSpec, LoadSpec, Vec3 } from '../types';
import type { KinematicSnapshot } from '../physics/simulation';
import { mat4AlignY, mat4LookAt, mat4Perspective, mat4Mul, sub, type Mat4 } from '../physics/math3d';
import { makeBoxMesh, makeCylinderMesh, makeGridMeshes, WebGLRenderer, type Mesh } from './renderer';
import { checkCollisions, loadBox } from '../physics/collision';

const Y_AXIS: Vec3 = { x: 0, y: 1, z: 0 };

/** 轨道相机：左键旋转、滚轮缩放、右键平移；可切换跟随吊物模式 */
export class OrbitCamera {
  azimuth = Math.PI * 0.75;
  elevation = 0.62;
  distance = 30;
  target: Vec3 = { x: 0, y: 2.5, z: 0 };
  private follow = false;

  constructor(private canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setFollow(on: boolean) {
    this.follow = on;
  }

  get isFollow() {
    return this.follow;
  }

  followTarget(t: Vec3) {
    if (this.follow) this.target = { x: t.x, y: Math.max(2, t.y), z: t.z };
  }

  private dragging: { x: number; y: number; button: number } | null = null;
  private onDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    this.dragging = { x: e.clientX, y: e.clientY, button: e.button };
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
  };
  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.dragging.x;
    const dy = e.clientY - this.dragging.y;
    this.dragging.x = e.clientX;
    this.dragging.y = e.clientY;
    if (this.dragging.button === 2) {
      this.target.x -= dx * 0.02 * Math.cos(this.azimuth);
      this.target.z -= dx * 0.02 * Math.sin(this.azimuth);
      this.target.y = Math.max(0, this.target.y + dy * 0.02);
    } else {
      this.azimuth -= dx * 0.008;
      this.elevation = Math.min(1.45, Math.max(0.12, this.elevation + dy * 0.008));
    }
  };
  private onUp = () => {
    this.dragging = null;
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.distance = Math.min(70, Math.max(8, this.distance + e.deltaY * 0.02));
  };

  get position(): Vec3 {
    const ce = Math.cos(this.elevation);
    return {
      x: this.target.x + this.distance * ce * Math.cos(this.azimuth),
      y: this.target.y + this.distance * Math.sin(this.elevation),
      z: this.target.z + this.distance * ce * Math.sin(this.azimuth),
    };
  }

  viewProj(aspect: number): Mat4 {
    const proj = mat4Perspective(Math.PI / 4, aspect, 0.1, 200);
    return mat4Mul(proj, mat4LookAt(this.position, this.target, Y_AXIS));
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }
}

export class CraneScene {
  private box: Mesh;
  private cylinder: Mesh;
  private rope: Mesh;
  private gridLine: Mesh;
  private gridTransforms: { pos: Vec3; scale: Vec3 }[];

  constructor(private renderer: WebGLRenderer, private workshop: WorkshopSpec, private loadSpec: LoadSpec) {
    const gl = renderer.gl;
    this.box = makeBoxMesh(gl);
    this.cylinder = makeCylinderMesh(gl, 24);
    this.rope = makeCylinderMesh(gl, 8);
    const grid = makeGridMeshes(gl, workshop.floorSize[0], workshop.floorSize[1]);
    this.gridLine = grid.line;
    this.gridTransforms = grid.transforms;
  }

  /** 每帧绘制全部场景。alarm 为当前是否处于 0.5m 报警区 */
  update(snap: KinematicSnapshot, alarm: boolean, failed: boolean): void {
    const r = this.renderer;
    const ws = this.workshop;

    // 地面与网格
    r.queue(this.box, { x: 0, y: -0.06, z: 0 }, [0.12, 0.14, 0.17], {
      scale: { x: ws.floorSize[0], y: 0.12, z: ws.floorSize[1] },
    });
    for (const t of this.gridTransforms) {
      r.queue(this.gridLine, t.pos, [0.22, 0.26, 0.31], { scale: t.scale });
    }

    // 目标垛位：绿色透明盒 + 描边底座
    for (const tg of ws.targets) {
      const isCurrent = tg.id === ws.targets[0].id;
      const col: [number, number, number] = isCurrent ? [0.25, 0.85, 0.4] : [0.3, 0.55, 0.75];
      r.queue(this.box, tg.center, col, { scale: tg.half, alpha: 0.22 });
      r.queue(this.box, { x: tg.center.x, y: 0.03, z: tg.center.z }, col, {
        scale: { x: tg.half.x * 2, y: 0.06, z: tg.half.z * 2 },
      });
    }

    // 障碍物 + 顶部警示条
    for (const o of ws.obstacles) {
      r.queue(this.box, o.center, o.color, { scale: o.half });
      r.queue(this.box, { x: o.center.x, y: o.center.y + o.half.y + 0.06, z: o.center.z }, [0.9, 0.65, 0.15], {
        scale: { x: o.half.x * 0.9, y: 0.12, z: o.half.z * 0.9 },
      });
    }

    // 大车轨道
    const [xMin, xMax] = ws.travelX;
    const [, zMax] = ws.travelZ;
    const railLen = xMax - xMin;
    r.queue(this.box, { x: (xMin + xMax) / 2, y: 0.12, z: -zMax - 0.8 }, [0.45, 0.45, 0.5], { scale: { x: railLen, y: 0.24, z: 0.18 } });
    r.queue(this.box, { x: (xMin + xMax) / 2, y: 0.12, z: zMax + 0.8 }, [0.45, 0.45, 0.5], { scale: { x: railLen, y: 0.24, z: 0.18 } });

    this.drawCrane(snap);
    this.drawHookAndLoad(snap, alarm, failed);
  }

  private drawCrane(snap: KinematicSnapshot) {
    const r = this.renderer;
    const ws = this.workshop;
    const [xMin, xMax] = ws.travelX;
    const [zMin, zMax] = ws.travelZ;
    const span = zMax - zMin + 1.6;
    const beamY = ws.pivotY + 0.35;

    // 支腿
    for (const x of [xMin + 0.4, xMax - 0.4]) {
      r.queue(this.box, { x, y: beamY / 2, z: -zMax - 0.8 }, [0.55, 0.42, 0.2], { scale: { x: 0.35, y: beamY, z: 0.35 } });
      r.queue(this.box, { x, y: beamY / 2, z: zMax + 0.8 }, [0.55, 0.42, 0.2], { scale: { x: 0.35, y: beamY, z: 0.35 } });
    }
    // 桥架主梁（随大车 X 移动）
    r.queue(this.box, { x: snap.pivot.x, y: beamY, z: (zMin + zMax) / 2 }, [0.78, 0.5, 0.18], {
      scale: { x: 0.5, y: 0.55, z: span },
    });
    // 小车与卷筒
    r.queue(this.box, { x: snap.pivot.x, y: ws.pivotY + 0.05, z: snap.pivot.z }, [0.85, 0.35, 0.2], {
      scale: { x: 1.1, y: 0.5, z: 0.9 },
    });
    r.queue(this.cylinder, { x: snap.pivot.x, y: ws.pivotY - 0.1, z: snap.pivot.z }, [0.35, 0.35, 0.4], {
      scale: { x: 0.9, y: 0.9, z: 0.9 },
    });
  }

  private drawRope(top: Vec3, bottom: Vec3, thickness: number, color: [number, number, number]) {
    const dir = sub(bottom, top);
    const len = Math.hypot(dir.x, dir.y, dir.z) || 0.001;
    const mid: Vec3 = { x: (top.x + bottom.x) / 2, y: (top.y + bottom.y) / 2, z: (top.z + bottom.z) / 2 };
    const model = mat4AlignY(mid, dir, { x: thickness, y: len, z: thickness });
    this.renderer.queueModel(this.rope, model, color);
  }

  private drawHookAndLoad(snap: KinematicSnapshot, alarm: boolean, failed: boolean) {
    const r = this.renderer;
    const spec = this.loadSpec;

    // 钢丝绳：吊点 -> 吊钩
    this.drawRope(snap.pivot, snap.hook, 0.05, [0.15, 0.15, 0.17]);

    // 吊钩组
    r.queue(this.box, snap.hook, [0.8, 0.8, 0.85], { scale: { x: 0.34, y: 0.5, z: 0.34 } });
    r.queue(this.cylinder, { x: snap.hook.x, y: snap.hook.y - 0.42, z: snap.hook.z }, [0.7, 0.7, 0.75], {
      scale: { x: 0.18, y: 0.4, z: 0.18 },
    });

    // 吊索：吊钩 -> 吊物（二级摆），两根分开画以体现不同吊点形式
    const load = snap.load;
    const spread = spec.kind === 'plate' ? 1.6 : spec.kind === 'mold' ? 0.9 : 0.5;
    const top: Vec3 = { x: snap.hook.x, y: snap.hook.y - 0.5, z: snap.hook.z };
    for (const side of [-1, 1]) {
      const bottom: Vec3 = {
        x: load.x + side * spread * 0.5,
        y: load.y + spec.half.y,
        z: load.z,
      };
      this.drawRope(top, bottom, 0.035, [0.25, 0.25, 0.28]);
    }

    // 吊物本体（报警变黄、碰撞失败变红）
    let color: [number, number, number] = spec.color;
    if (failed) color = [0.9, 0.2, 0.2];
    else if (alarm) color = [0.95, 0.75, 0.15];
    r.queue(this.box, load, color, { scale: spec.half });

    // 外形特征区分：钢卷中心孔 / 钢板叠层 / 模具顶块
    if (spec.kind === 'coil') {
      r.queue(this.cylinder, { x: load.x, y: load.y, z: load.z }, [0.1, 0.1, 0.12], {
        scale: { x: 0.7, y: 0.7, z: 0.7 },
      });
    } else if (spec.kind === 'plate') {
      for (let i = 0; i < 3; i++) {
        r.queue(this.box, { x: load.x, y: load.y + (i - 1) * 0.12, z: load.z }, [0.62, 0.68, 0.76], {
          scale: { x: spec.half.x * 0.96, y: 0.03, z: spec.half.z * 0.96 },
        });
      }
    } else {
      r.queue(this.box, { x: load.x, y: load.y + spec.half.y * 0.7, z: load.z }, [0.35, 0.25, 0.18], {
        scale: { x: spec.half.x * 0.5, y: 0.18, z: spec.half.z * 0.5 },
      });
    }
  }

  /** 当前吊物与障碍物的报警状态（供 HUD 与变色共用） */
  static evaluateAlarm(snap: KinematicSnapshot, spec: LoadSpec, ws: WorkshopSpec): { alarm: boolean; minGap: number; hit: boolean } {
    const box = loadBox(snap.load, spec.half);
    const res = checkCollisions(box, ws.obstacles);
    return { alarm: res.nearLabels.length > 0, minGap: res.minGap, hit: res.hit };
  }
}
