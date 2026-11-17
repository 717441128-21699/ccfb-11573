import type { Vec3 } from '../types';
import { mat4Mul, mat4Perspective, mat4Scale, mat4Translation, type Mat4 } from '../physics/math3d';

export interface Mesh {
  vao: WebGLVertexArrayObject;
  indexCount: number;
  /** 包围球半径 */
  radius: number;
}

interface ShaderProgram {
  program: WebGLProgram;
  locs: Record<string, WebGLUniformLocation | null>;
}

interface DrawItem {
  mesh: Mesh;
  model: Mat4;
  color: [number, number, number];
  alpha: number;
}

const VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uModel;
uniform mat4 uViewProj;
out vec3 vNormal;
out vec3 vWorld;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uViewProj * world;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
uniform vec3 uColor;
uniform float uAlpha;
uniform vec3 uLightDir;
uniform vec3 uCameraPos;
out vec4 frag;
void main() {
  vec3 n = normalize(vNormal);
  vec3 l = normalize(uLightDir);
  float diff = max(dot(n, l), 0.0);
  vec3 view = normalize(uCameraPos - vWorld);
  vec3 halfV = normalize(l + view);
  float spec = pow(max(dot(n, halfV), 0.0), 28.0) * 0.25;
  vec3 ambient = uColor * 0.38;
  vec3 lit = ambient + uColor * (diff * 0.62) + vec3(spec);
  frag = vec4(lit, uAlpha);
}`;

/** 由交错顶点数据（pos.xyz, normal.xyz）+ 索引创建网格 */
export function createMesh(gl: WebGL2RenderingContext, vertices: Float32Array, indices: Uint32Array, radius: number): Mesh {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  const ebo = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, indexCount: indices.length, radius };
}

export class WebGLRenderer {
  readonly gl: WebGL2RenderingContext;
  private solid: ShaderProgram;
  private opaque: DrawItem[] = [];
  private transparent: DrawItem[] = [];
  viewProj: Mat4;
  cameraPos: Vec3 = { x: 0, y: 10, z: 22 };
  lightDir: Vec3 = { x: -0.45, y: -1, z: 0.35 };

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.solid = this.buildProgram(VERT, FRAG);
    this.viewProj = mat4Perspective(Math.PI / 4, 1, 0.1, 200);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0.07, 0.09, 0.12, 1);
  }

  resize(width: number, height: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    if (this.gl.canvas.width !== w || this.gl.canvas.height !== h) {
      this.gl.canvas.width = w;
      this.gl.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  setViewProj(vp: Mat4, cameraPos: Vec3): void {
    this.viewProj = vp;
    this.cameraPos = cameraPos;
  }

  private buildProgram(vs: string, fs: string): ShaderProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error('着色器编译失败: ' + gl.getShaderInfoLog(sh));
      }
      return sh;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('程序链接失败: ' + gl.getProgramInfoLog(program));
    }
    const names = ['uModel', 'uViewProj', 'uColor', 'uAlpha', 'uLightDir', 'uCameraPos'];
    const locs: Record<string, WebGLUniformLocation | null> = {};
    for (const n of names) locs[n] = gl.getUniformLocation(program, n);
    return { program, locs };
  }

  queue(mesh: Mesh, pos: Vec3, color: [number, number, number], opts?: { scale?: Vec3; alpha?: number }): void {
    let model = mat4Translation(pos);
    if (opts?.scale) model = mat4Mul(model, mat4Scale(opts.scale));
    const item: DrawItem = { mesh, model, color, alpha: opts?.alpha ?? 1 };
    if (item.alpha < 1) this.transparent.push(item);
    else this.opaque.push(item);
  }

  /** 直接提交自定义模型矩阵（倾斜绳段等） */
  queueModel(mesh: Mesh, model: Mat4, color: [number, number, number], alpha = 1): void {
    const item: DrawItem = { mesh, model, color, alpha };
    if (alpha < 1) this.transparent.push(item);
    else this.opaque.push(item);
  }

  render(): void {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.solid.program);
    gl.uniformMatrix4fv(this.solid.locs.uViewProj, false, this.viewProj);
    gl.uniform3fv(this.solid.locs.uLightDir, [this.lightDir.x, this.lightDir.y, this.lightDir.z]);
    gl.uniform3fv(this.solid.locs.uCameraPos, [this.cameraPos.x, this.cameraPos.y, this.cameraPos.z]);

    for (const item of this.opaque) this.draw(item);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    for (const item of this.transparent) this.draw(item);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    this.opaque.length = 0;
    this.transparent.length = 0;
  }

  private draw(item: DrawItem) {
    const gl = this.gl;
    const l = this.solid.locs;
    gl.uniformMatrix4fv(l.uModel, false, item.model);
    gl.uniform3fv(l.uColor, item.color);
    gl.uniform1f(l.uAlpha, item.alpha);
    gl.bindVertexArray(item.mesh.vao);
    gl.drawElements(gl.TRIANGLES, item.mesh.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }
}

// ---------- 基础几何生成：均为单位尺寸，绘制时用 scale 缩放 ----------

export function makeBoxMesh(gl: WebGL2RenderingContext): Mesh {
  // 24 个顶点（每面独立法线），36 个索引；单位立方体，边长 1，中心在原点
  const n = [
    0.5, 0, 0, 0.5, 0, 0, 0.5, 0, 0, 0.5, 0, 0,
    -0.5, 0, 0, -0.5, 0, 0, -0.5, 0, 0, -0.5, 0, 0,
    0, 0.5, 0, 0, 0.5, 0, 0, 0.5, 0, 0, 0.5, 0,
    0, -0.5, 0, 0, -0.5, 0, 0, -0.5, 0, 0, -0.5, 0,
    0, 0, 0.5, 0, 0, 0.5, 0, 0, 0.5, 0, 0, 0.5,
    0, 0, -0.5, 0, 0, -0.5, 0, 0, -0.5, 0, 0, -0.5,
  ];
  const p = [
    0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5,
    -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5,
    -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5, -0.5,
    -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5,
    0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, -0.5,
  ];
  const verts = new Float32Array(24 * 6);
  for (let i = 0; i < 24; i++) {
    verts[i * 6] = p[i * 3]; verts[i * 6 + 1] = p[i * 3 + 1]; verts[i * 6 + 2] = p[i * 3 + 2];
    verts[i * 6 + 3] = n[i * 3]; verts[i * 6 + 4] = n[i * 3 + 1]; verts[i * 6 + 5] = n[i * 3 + 2];
  }
  const idx: number[] = [];
  for (let f = 0; f < 6; f++) {
    const b = f * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return createMesh(gl, verts, new Uint32Array(idx), 0.866);
}

export function makeCylinderMesh(gl: WebGL2RenderingContext, segments = 20): Mesh {
  const verts: number[] = [];
  const idx: number[] = [];
  // 侧面：单位高度、直径 1、中心在原点、轴沿 Y
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a) * 0.5;
    const z = Math.sin(a) * 0.5;
    verts.push(x, -0.5, z, x, 0, z);
    verts.push(x, 0.5, z, x, 0, z);
  }
  for (let i = 0; i < segments; i++) {
    const b = i * 2;
    idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
  }
  const topCenter = verts.length / 6;
  verts.push(0, 0.5, 0, 0, 1, 0);
  const topStart = verts.length / 6;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    verts.push(Math.cos(a) * 0.5, 0.5, Math.sin(a) * 0.5, 0, 1, 0);
  }
  for (let i = 0; i < segments; i++) idx.push(topCenter, topStart + i, topStart + i + 1);

  const botCenter = verts.length / 6;
  verts.push(0, -0.5, 0, 0, -1, 0);
  const botStart = verts.length / 6;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    verts.push(Math.cos(a) * 0.5, -0.5, Math.sin(a) * 0.5, 0, -1, 0);
  }
  for (let i = 0; i < segments; i++) idx.push(botCenter, botStart + i + 1, botStart + i);

  return createMesh(gl, new Float32Array(verts), new Uint32Array(idx), 0.707);
}

/** 地面网格：交叉细线用细盒子拼成，避免额外着色器 */
export function makeGridMeshes(gl: WebGL2RenderingContext, sizeX: number, sizeZ: number, step = 2): { line: Mesh; transforms: { pos: Vec3; scale: Vec3 }[] } {
  const line = makeBoxMesh(gl);
  const transforms: { pos: Vec3; scale: Vec3 }[] = [];
  const y = 0.01;
  for (let x = -sizeX / 2; x <= sizeX / 2 + 1e-6; x += step) {
    transforms.push({ pos: { x, y, z: 0 }, scale: { x: 0.025, y: 0.025, z: sizeZ } });
  }
  for (let z = -sizeZ / 2; z <= sizeZ / 2 + 1e-6; z += step) {
    transforms.push({ pos: { x: 0, y, z }, scale: { x: sizeX, y: 0.025, z: 0.025 } });
  }
  return { line, transforms };
}
