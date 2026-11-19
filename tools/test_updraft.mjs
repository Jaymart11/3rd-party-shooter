// Headless check that every Updraft parkour route is possible with the real movement physics.
// Run: node tools/test_updraft.mjs
import * as THREE from 'three';
import { LocalPlayer } from '../public/js/player.js';
import { setMap, buildColliders, MAP } from '../public/js/shared.js';

setMap('updraft');
const me = new LocalPlayer(new THREE.PerspectiveCamera(), buildColliders(MAP));
me.setMode('standard');
const DT = 1 / 60;
const tick = () => { me.physics(DT, {}); me.updateCamera(DT); };
const run = (sec, each) => { for (let t = 0; t < sec; t += DT) { each?.(t); tick(); } };
const r2 = v => +v.toFixed(2);
let ok = true;
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`, JSON.stringify(info)); ok &&= !!cond; };
// yaw 0 = facing -z, so W:-z  S:+z  A:-x  D:+x
const place = (x, y, z, yaw = 0) => { me.spawn([x, y, z], yaw); me.keys.clear(); run(0.3); };
const hold = (...k) => { me.keys.clear(); k.forEach(x => me.keys.add(x)); };
const jump = () => { me.keys.add('Space'); tick(); me.keys.delete('Space'); };

// A player in a chimney: press jump whenever touching a wall in the air. Near the top, use a wall jump
// that pushes toward the exit to carry you over the edge. `exitAt` is how far below the top you commit.
function climbOnce(start, intoWallKey, exitKey, topY, exitAt, walkOn) {
  place(...start);
  hold(intoWallKey);
  jump();
  const exitDir = { KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] }[exitKey];
  let walls = 0, peak = 0, exiting = false, exitT = 0;
  run(5, () => {
    peak = Math.max(peak, me.pos.y);
    const n = !me.grounded && me.wallJumpCd <= 0 ? me.wallNormal() : null;
    if (!exiting && n) {
      me.jumpQueued = true; walls++; me.keys.clear();
      if (me.pos.y > topY - exitAt && n.x * exitDir[0] + n.z * exitDir[1] > 0.5) { exiting = true; hold(exitKey); }
    }
    if (!exiting && me.pos.y > topY + 0.5) { exiting = true; hold(exitKey); }
    if (exiting && me.grounded && (exitT += DT) >= walkOn) me.keys.clear();
  });
  return { walls, peak: r2(peak), end: [r2(me.pos.x), r2(me.pos.y), r2(me.pos.z)], grounded: me.grounded };
}
// like a player practising: is there any timing that gets you to the top?
function climb(start, intoWallKey, exitKey, topY, ok, walkOn = 0.3) {
  const tried = [];
  for (let k = 0; k <= 2.4; k += 0.2) {
    const r = climbOnce(start, intoWallKey, exitKey, topY, k, walkOn);
    if (r.grounded && Math.abs(r.end[1] - topY) < 0.05 && ok(r)) return { ...r, exitAt: r2(k), attempts: tried.length + 1 };
    tried.push(r.end);
  }
  return { failed: true, attempts: tried.length };
}

// 1. corner tower chimney (walls at x=-24.9 / -23.1), exit east onto the 6 m roof
let res = climb([-24, 0, 13.2], 'KeyA', 'KeyD', 6, () => true);
check('tower chimney -> 6 m roof', !res.failed, res);

// 2. dash gap: plank 1 (x -18.25..-14.75, top 6) to plank 2 (x -11..-8)
function gapRun(fromX, z, useDash) {
  place(fromX, 6.001, z, -Math.PI / 2); // facing +x
  hold('KeyW');
  let jumped = false, dashed = false;
  let landed = false;
  run(2.2, () => {
    if (landed) return;
    if (!jumped && me.grounded && me.pos.x > fromX + 1.7) { jump(); jumped = true; return; }
    if (useDash && jumped && !dashed && me.pos.y > 6.4) { me.dash(); dashed = true; }
    if (jumped && me.grounded) { landed = true; me.keys.clear(); } // stop once you land, like a player would
  });
  return { x: r2(me.pos.x), y: r2(me.pos.y), grounded: me.grounded };
}
res = gapRun(-17.9, 16, false);
check('plank gap is NOT makeable without a dash', res.y < 5, res);
res = gapRun(-17.9, 16, true);
check('plank gap made with jump + dash', res.y > 5.9 && res.x > -11 && res.x < -8, res);

// 3. plank 2 -> high middle platform (x -4..4) with jump + dash
res = gapRun(-10.6, 16, true);
check('plank 2 -> middle platform with jump + dash', res.y > 5.9 && res.x > -4, res);

// 4. centre tower chimney (walls at z=+-0.95), exit north onto the 7 m roof
res = climb([-1.8, 0, 0], 'KeyS', 'KeyW', 7, () => true);
check('centre tower chimney -> 7 m roof', !res.failed, res);

// 5. fin chimney (x -1.0..1.0, z 18..22) up to the middle platform (exit toward -z)
res = climb([0, 0, 20.5], 'KeyA', 'KeyW', 6, r => r.end[2] < 18);
check('fin chimney -> middle platform', !res.failed, res);

// 6. wall-jump alley: bounce between the fins (z 22.8 / 24.8) up to the fin tops
res = climb([-12, 0, 23.8], 'KeyS', 'KeyS', 6, () => true);
check('alley -> walkway on top (6 m)', !res.failed, res);

// 7. jump staircase: 1 m steps going west, then onto the tower roof (no wall jumps needed)
place(-19.3, 0, 21.75, Math.PI / 2); // facing -x
let lastJump = -1;
hold('KeyW');
let onTop = false;
run(6, t => {
  if (onTop) return;
  if (me.grounded && me.pos.y > 5.9) { onTop = true; me.keys.clear(); return; }
  if (me.pos.x < -25.6 && me.pos.y > 4.9) hold('KeyD'); // top step reached: turn toward the roof (-z when facing -x is D)
  if (me.grounded && t - lastJump > 0.15) { jump(); lastJump = t; }
});
check('jump staircase -> tower roof', me.grounded && Math.abs(me.pos.y - 6) < 0.05, { end: [r2(me.pos.x), r2(me.pos.y), r2(me.pos.z)] });

process.exit(ok ? 0 : 1);
