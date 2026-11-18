import { mat4LookAt, mat4Perspective, type Mat4, type Vec3 } from './math';

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
out vec3 vNormal;
out vec3 vWorld;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uProj * uView * w;
}`;

const FS = `#version 300 es
precision mediump float;
in vec3 vNormal;
in vec3 vWorld;
uniform vec3 uColor;
uniform float uAlpha;
uniform vec3 uLightDir;
uniform vec3 uEye;
out vec4 frag;
void main() {
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, -uLightDir), 0.0);
  vec3 viewDir = normalize(uEye - vWorld);
  vec3 h = normalize(viewDir - uLightDir);
  float spec = pow(max(dot(n, h), 0.0), 32.0) * 0.25;
  vec3 col = uColor * (0.35 + 0.65 * diff) + vec3(spec);
  frag = vec4(col, uAlpha);
}`;

interface Mesh {
  vao: WebGLVertexArrayObject;
  count: number;
  indexed: boolean;
  mode: number;
}

export class Camera {
  yaw = 0.8;
  pitch = 0.55;
  dist = 26;
  target: Vec3 = { x: 0, y: 2, z: 0 };
  follow = true;

  eye(): Vec3 {
    const cp = Math.cos(this.pitch);
    return {
      x: this.target.x + this.dist * cp * Math.sin(this.yaw),
      y: this.target.y + this.dist * Math.sin(this.pitch),
      z: this.target.z + this.dist * cp * Math.cos(this.yaw),
    };
  }

  view(): Mat4 {
    return mat4LookAt(this.eye(), this.target, { x: 0, y: 1, z: 0 });
  }
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private uProj: WebGLUniformLocation | null;
  private uView: WebGLUniformLocation | null;
  private uModel: WebGLUniformLocation | null;
  private uColor: WebGLUniformLocation | null;
  private uAlpha: WebGLUniformLocation | null;
  private uLightDir: WebGLUniformLocation | null;
  private uEye: WebGLUniformLocation | null;

  readonly box: Mesh;
  readonly cyl: Mesh;
  readonly grid: Mesh;
  readonly camera = new Camera();

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.prog = buildProgram(gl, VS, FS);
    gl.useProgram(this.prog);
    this.uProj = gl.getUniformLocation(this.prog, 'uProj');
    this.uView = gl.getUniformLocation(this.prog, 'uView');
    this.uModel = gl.getUniformLocation(this.prog, 'uModel');
    this.uColor = gl.getUniformLocation(this.prog, 'uColor');
    this.uAlpha = gl.getUniformLocation(this.prog, 'uAlpha');
    this.uLightDir = gl.getUniformLocation(this.prog, 'uLightDir');
    this.uEye = gl.getUniformLocation(this.prog, 'uEye');

    this.box = createBoxMesh(gl);
    this.cyl = createCylinderMesh(gl, 24);
    this.grid = createGridMesh(gl, 30);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.078, 0.09, 0.11, 1);
  }

  /** 每帧开始：自适应尺寸、设置相机与光照 */
  begin(focus: Vec3 | null): void {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const cam = this.camera;
    if (focus && cam.follow) {
      const t = { x: focus.x, y: Math.max(1.5, focus.y), z: focus.z };
      cam.target.x += (t.x - cam.target.x) * 0.08;
      cam.target.y += (t.y - cam.target.y) * 0.08;
      cam.target.z += (t.z - cam.target.z) * 0.08;
    }

    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.uProj, false, mat4Perspective(Math.PI / 3.2, w / Math.max(h, 1), 0.1, 300));
    gl.uniformMatrix4fv(this.uView, false, cam.view());
    const ld = norm3(-0.45, -1, -0.35);
    gl.uniform3f(this.uLightDir, ld[0], ld[1], ld[2]);
    const eye = cam.eye();
    gl.uniform3f(this.uEye, eye.x, eye.y, eye.z);
  }

  draw(mesh: Mesh, model: Mat4, color: [number, number, number], alpha = 1): void {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.uModel, false, model);
    gl.uniform3f(this.uColor, color[0], color[1], color[2]);
    gl.uniform1f(this.uAlpha, alpha);
    gl.bindVertexArray(mesh.vao);
    if (mesh.indexed) {
      gl.drawElements(mesh.mode, mesh.count, gl.UNSIGNED_SHORT, 0);
    } else {
      gl.drawArrays(mesh.mode, 0, mesh.count);
    }
  }
}

function norm3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function buildProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const compile = (type: number, src: string): WebGLShader => {
    const sh = gl.createShader(type);
    if (!sh) throw new Error('createShader failed');
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error('shader: ' + gl.getShaderInfoLog(sh));
    }
    return sh;
  };
  const prog = gl.createProgram();
  if (!prog) throw new Error('createProgram failed');
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('link: ' + gl.getProgramInfoLog(prog));
  }
  return prog;
}

function makeMesh(
  gl: WebGL2RenderingContext,
  positions: number[],
  normals: number[],
  indices: number[] | null,
  mode: number,
): Mesh {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error('createVertexArray failed');
  gl.bindVertexArray(vao);

  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  const nrmBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  let count: number;
  let indexed = false;
  if (indices) {
    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    count = indices.length;
    indexed = true;
  } else {
    count = positions.length / 3;
  }
  gl.bindVertexArray(null);
  return { vao, count, indexed, mode };
}

/** 单位盒：中心原点，边长 1 */
function createBoxMesh(gl: WebGL2RenderingContext): Mesh {
  const p: number[] = [];
  const n: number[] = [];
  const idx: number[] = [];
  const faces: Array<[number[], number[][]]> = [
    [[1, 0, 0], [[0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5]]],
    [[-1, 0, 0], [[-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5]]],
    [[0, 1, 0], [[-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5]]],
    [[0, -1, 0], [[-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5]]],
    [[0, 0, 1], [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]],
    [[0, 0, -1], [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]]],
  ];
  for (const [normal, corners] of faces) {
    const base = p.length / 3;
    for (const c of corners) {
      p.push(c[0], c[1], c[2]);
      n.push(normal[0], normal[1], normal[2]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return makeMesh(gl, p, n, idx, gl.TRIANGLES);
}

/** 单位圆柱：y∈[-0.5,0.5]，半径 1 */
function createCylinderMesh(gl: WebGL2RenderingContext, seg: number): Mesh {
  const p: number[] = [];
  const n: number[] = [];
  const idx: number[] = [];
  // 侧面
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    p.push(c, -0.5, s, c, 0.5, s);
    n.push(c, 0, s, c, 0, s);
  }
  for (let i = 0; i < seg; i++) {
    const b = i * 2;
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  // 上下盖
  for (const [y, ny] of [[0.5, 1], [-0.5, -1]] as Array<[number, number]>) {
    const center = p.length / 3;
    p.push(0, y, 0);
    n.push(0, ny, 0);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      p.push(Math.cos(a), y, Math.sin(a));
      n.push(0, ny, 0);
    }
    for (let i = 0; i < seg; i++) {
      if (ny > 0) idx.push(center, center + 1 + i, center + 2 + i);
      else idx.push(center, center + 2 + i, center + 1 + i);
    }
  }
  return makeMesh(gl, p, n, idx, gl.TRIANGLES);
}

/** 地面网格线：[-0.5,0.5] 见方，div 等分，GL_LINES */
function createGridMesh(gl: WebGL2RenderingContext, div: number): Mesh {
  const p: number[] = [];
  const n: number[] = [];
  for (let i = 0; i <= div; i++) {
    const t = -0.5 + i / div;
    p.push(t, 0, -0.5, t, 0, 0.5);
    p.push(-0.5, 0, t, 0.5, 0, t);
    for (let k = 0; k < 4; k++) n.push(0, 1, 0);
  }
  return makeMesh(gl, p, n, null, gl.LINES);
}
