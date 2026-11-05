const fs = require('fs');
const vm = require('vm');

const raw = fs.readFileSync('mihong.html', 'utf8');
const js = raw.slice(raw.indexOf('<script>') + 8, raw.lastIndexOf('</script>'));

const anyObj = new Proxy(function () {}, {
  get(t, k) {
    if (k === 'width' || k === 'height') return 10;
    if (k === Symbol.toPrimitive) return () => 0;
    if (k === 'then') return undefined;
    return anyObj;
  },
  set() { return true; },
  apply() { return anyObj; }
});

const ctx = new Proxy({}, {
  get(t, k) {
    if (k === 'canvas') return { width: 1280, height: 720 };
    if (k === 'measureText') return () => ({ width: 10 });
    if (k in t) return t[k];
    return () => anyObj;
  },
  set(t, k, v) { t[k] = v; return true; }
});

function mkEl() {
  return {
    style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    textContent: '', innerHTML: '', width: 1280, height: 720,
    getContext: () => ctx,
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, removeChild() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720 }),
    querySelector: () => mkEl(), querySelectorAll: () => [],
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    focus() {}, blur() {}, play() {}, pause() {}
  };
}

let fakeNow = 0, frameCb = null;

const sandbox = {
  console, Math, Date, JSON, Object, Array, String, Number, Boolean, Error,
  isNaN, parseInt, parseFloat, Symbol, Proxy,
  performance: { now: () => fakeNow },
  requestAnimationFrame: (cb) => { frameCb = cb; return 1; },
  cancelAnimationFrame() {},
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
  document: {
    getElementById: () => mkEl(), querySelector: () => mkEl(), querySelectorAll: () => [],
    createElement: () => mkEl(), addEventListener() {},
    body: mkEl(), documentElement: mkEl(), hidden: false, visibilityState: 'visible'
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  navigator: { userAgent: 'node', maxTouchPoints: 0 },
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  addEventListener() {}, removeEventListener() {}
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
try {
  vm.runInContext(js, sandbox, { filename: 'game.js' });
} catch (e) {
  console.error('LOAD FAIL:', e.message);
  process.exit(1);
}

const N = sandbox.window.__NEON__;
if (!N) { console.error('FAIL: __NEON__ not exposed'); process.exit(1); }

function stepFrames(n) {
  for (let i = 0; i < n; i++) {
    fakeNow += 16.7;
    if (frameCb) frameCb(fakeNow);
  }
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')); pass++; }
  else { console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); fail++; }
}

stepFrames(3);
N.game.state = 'playing';
stepFrames(3);

const p = N.player;

// ---- TEST 1: 经验球不自动吸附 ----
N.orbs.length = 0;
const orb = { x: p.x + 420, y: p.y, vx: 0, vy: 0, val: 5, r: 4, life: 30, age: 0, kind: 'xp' };
N.orbs.push(orb);
const d0 = Math.hypot(orb.x - p.x, orb.y - p.y);
stepFrames(120);
const d1 = Math.hypot(orb.x - p.x, orb.y - p.y);
check('orb not magnetized (distance unchanged)', Math.abs(d1 - d0) < 6, 'd0=' + d0.toFixed(1) + ' d1=' + d1.toFixed(1));
check('orb not auto-collected', N.orbs.length === 1 || N.orbs.indexOf(orb) >= 0, 'orbs=' + N.orbs.length);
N.orbs.length = 0;

// ---- TEST 2: Boss 出场无敌 ----
N.game.time = 100;
const b = N.spawnBoss(0);
check('boss spawn not locked', b.hpLocked === false);
check('boss placeholder hp=1', b.hp === 1 && b.maxHp === 1, 'hp=' + b.hp);
stepFrames(72);   // 1.2s（仍在 2 秒出场动画内）
check('still invincible during intro', b.hpLocked === false && b.hp === 1, 'introT=' + b.introT.toFixed(2));
check('damage sampled (probeDmg>0)', b.probeDmg > 0, 'probe=' + Math.round(b.probeDmg));

// ---- TEST 3: 动画结束后一次性锁血 ----
let lockHp = null, lockMax = null;
for (let i = 0; i < 200; i++) {
  stepFrames(1);
  if (b.hpLocked) { lockHp = b.hp; lockMax = b.maxHp; break; }
}
check('hp locked after intro', b.hpLocked === true, 'introT=' + b.introT.toFixed(2));
check('hp === maxHp at lock (full bar)', lockHp === lockMax, 'hp=' + Math.round(lockHp) + ' max=' + Math.round(lockMax));
check('locked hp in sane range', b.maxHp >= 1500 && b.maxHp <= 6000000, 'maxHp=' + Math.round(b.maxHp));

// ---- TEST 4: 锁血后不再回血 ----
const hpA = b.hp, maxA = b.maxHp;
let everHealed = false;
for (let i = 0; i < 300; i++) {
  const before = b.hp;
  stepFrames(1);
  if (!N.enemies.includes(b)) break;
  if (b.hp > before + 0.001) { everHealed = true; break; }
}
check('maxHp never changes after lock', b.maxHp === maxA || !N.enemies.includes(b), 'maxHp=' + Math.round(b.maxHp));
check('hp never increases after lock', !everHealed, 'hp ' + Math.round(hpA) + ' -> ' + Math.round(b.hp));

// ---- TEST 5: 血包红色粒子路径不报错 ----
N.orbs.push({ x: p.x + 30, y: p.y, vx: 0, vy: 0, val: 20, r: 6, life: 20, age: 0, kind: 'hp' });
try { stepFrames(20); console.log('  PASS  hp orb render path'); pass++; }
catch (e) { console.log('  FAIL  hp orb render: ' + e.message); fail++; }

// ---- TEST 6: 磁力场词条改为 pickup ----
const mag = N.upgradeList.find(u => u.id === 'magnet');
const basePickup = p.pickup;
mag.apply(p);
check('magnet upgrade adds pickup range', p.pickup === basePickup + 18, 'pickup=' + p.pickup);

console.log('\n===== RESULT: ' + pass + ' passed, ' + fail + ' failed =====');
process.exit(fail ? 1 : 0);
