// 物理冒烟测试：双摆周期、绳长对周期的影响、数值稳定性、碰撞与落地检测
import { Simulation, type Cmd } from '../src/physics';
import { WORKSHOPS, LOADS } from '../src/config';

const DT = 0.001;
const idle: Cmd = { b: 0, t: 0, h: 0, inch: false };

function run(sim: Simulation, seconds: number, cmd: Cmd, onStep?: () => void): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    sim.step(DT, cmd);
    if (onStep) onStep();
    for (const v of [sim.hookP.x, sim.hookP.y, sim.hookP.z, sim.loadP.x, sim.loadP.y, sim.loadP.z]) {
      if (!Number.isFinite(v)) throw new Error('NaN/Inf in simulation state');
    }
  }
}

function measurePeriod(sim: Simulation, seconds: number): number {
  const crossings: number[] = [];
  let prev = sim.hookP.x - sim.bridgeX;
  let t = 0;
  run(sim, seconds, idle, () => {
    t += DT;
    const cur = sim.hookP.x - sim.bridgeX;
    if (prev < 0 && cur >= 0) crossings.push(t);
    prev = cur;
  });
  if (crossings.length < 2) return NaN;
  const periods: number[] = [];
  for (let i = 1; i < crossings.length; i++) periods.push(crossings[i] - crossings[i - 1]);
  return periods.reduce((a, b) => a + b, 0) / periods.length;
}

const ws = WORKSHOPS[0];
const load = LOADS[0];

// 1) 长绳周期：先拉一下大车激起摆动，再测周期
const sim1 = new Simulation(ws, load);
console.log(`初始绳长 L1=${sim1.ropeLen.toFixed(2)}m, 索具 L2=${load.rigLen}m`);
run(sim1, 2, { b: 0.6, t: 0, h: 0, inch: false });
run(sim1, 2, idle); // 车停，吊物自由摆
const p1 = measurePeriod(sim1, 30);
console.log(`长绳摆动周期 ≈ ${p1.toFixed(2)}s`);

// 2) 收短绳后周期应变小
const sim2 = new Simulation(ws, load);
run(sim2, 4, { b: 0, t: 0, h: 1, inch: false }); // 起升收绳
console.log(`收绳后 L1=${sim2.ropeLen.toFixed(2)}m`);
run(sim2, 2, { b: 0.6, t: 0, h: 0, inch: false });
run(sim2, 2, idle);
const p2 = measurePeriod(sim2, 30);
console.log(`短绳摆动周期 ≈ ${p2.toFixed(2)}s`);

if (!(p1 > 3 && p1 < 8)) throw new Error(`长绳周期异常: ${p1}`);
if (!(p2 > 1.5 && p2 < p1 - 0.5)) throw new Error(`短绳周期未明显变小: ${p2} vs ${p1}`);
console.log('OK: 绳长变短 → 周期变小（符合 T∝√L）');

// 3) 起升中摆动不应发散（60s 稳定性）
const sim3 = new Simulation(ws, load);
run(sim3, 3, { b: 0.8, t: 0.5, h: 0, inch: false });
run(sim3, 30, { b: 0, t: 0, h: 0.5, inch: false });
run(sim3, 30, idle);
const s3 = sim3.swingDeg();
console.log(`60s 后摆角 rope=${s3.rope.toFixed(1)}° load=${s3.load.toFixed(1)}°（阻尼应使其衰减）`);
if (s3.max > 45) throw new Error('摆动发散');

// 4) 碰撞检测：把吊车整体移到料架正上方，吊物放进料架里
//    （桥/小车/绳长/钩/物摆成一致状态，避免约束把吊物拽回）
function placeAt(sim: Simulation, x: number, z: number, loadY: number): void {
  sim.bridgeX = x;
  sim.trolleyZ = z;
  const hookY = loadY + sim.load.rigLen;
  sim.ropeLen = sim.ws.craneHeight - hookY;
  sim.hookP = { x, y: hookY, z };
  sim.hookPP = { ...sim.hookP };
  sim.loadP = { x, y: loadY, z };
  sim.loadPP = { ...sim.loadP };
}

const sim4 = new Simulation(ws, load);
const ob = ws.obstacles[0];
placeAt(
  sim4,
  (ob.min.x + ob.max.x) / 2,
  (ob.min.z + ob.max.z) / 2,
  (ob.min.y + ob.max.y) / 2,
);
sim4.step(DT, idle);
if (!sim4.collision) throw new Error('碰撞未检出');
console.log('OK: 碰撞检测');

// 5) 报警区：吊物放到料架旁 0.3m
const sim5 = new Simulation(ws, load);
placeAt(
  sim5,
  (ob.min.x + ob.max.x) / 2,
  ob.max.z + 0.3 + load.size.z / 2,
  load.size.y / 2 + 0.01,
);
sim5.step(DT, idle);
if (!sim5.alarm || sim5.collision) throw new Error(`报警区判定错误 alarm=${sim5.alarm} collision=${sim5.collision}`);
console.log('OK: 0.5m 报警区');

// 6) 落地：松钩到底
const sim6 = new Simulation(ws, load);
run(sim6, 15, { b: 0, t: 0, h: -1, inch: false });
run(sim6, 3, idle);
if (!sim6.resting) throw new Error('吊物未落地');
console.log('OK: 落地检测');

console.log('\n全部物理测试通过 ✓');
