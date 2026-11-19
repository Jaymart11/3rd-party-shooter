// Scripted "player" for testing parkour routes with the real movement physics (no rendering).
import * as THREE from 'three';
import { LocalPlayer } from '../public/js/player.js';
import { setMap, buildColliders, MAP } from '../public/js/shared.js';

export function createRig(mapId) {
  setMap(mapId);
  const me = new LocalPlayer(new THREE.PerspectiveCamera(), buildColliders(MAP));
  me.setMode('standard');
  const DT = 1 / 60;
  const tick = () => { me.physics(DT, {}); me.updateCamera(DT); };
  const run = (sec, each) => { for (let t = 0; t < sec; t += DT) { if (each?.(t) === false) break; tick(); } };
  const r2 = v => +v.toFixed(2);
  // yaw 0 = facing -z, so W:-z  S:+z  A:-x  D:+x
  const place = (x, y, z, yaw = 0) => { me.spawn([x, y + 0.001, z], yaw); me.keys.clear(); run(0.3); };
  const hold = (...k) => { me.keys.clear(); k.forEach(x => me.keys.add(x)); };
  const jump = () => { me.keys.add('Space'); tick(); me.keys.delete('Space'); };
  const where = () => ({ end: [r2(me.pos.x), r2(me.pos.y), r2(me.pos.z)], grounded: me.grounded });

  // chimney: bounce wall to wall; near the top, a wall jump toward the exit carries you out
  function climbOnce(start, intoWallKey, exitKey, topY, exitAt, walkOn) {
    place(...start);
    hold(intoWallKey);
    jump();
    const exitDir = { KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] }[exitKey];
    let walls = 0, exiting = false, exitT = 0;
    run(8, () => {
      const n = !me.grounded && me.wallJumpCd <= 0 ? me.wallNormal() : null;
      if (!exiting && n) {
        me.jumpQueued = true; walls++; me.keys.clear();
        if (me.pos.y > topY - exitAt && n.x * exitDir[0] + n.z * exitDir[1] > 0.5) { exiting = true; hold(exitKey); }
      }
      if (!exiting && me.pos.y > topY + 0.5) { exiting = true; hold(exitKey); }
      if (exiting && me.grounded && (exitT += DT) >= walkOn) { me.keys.clear(); return false; }
    });
    return { walls, ...where() };
  }
  // like a player practising: is there any timing that gets you to the top?
  function climb(start, intoWallKey, exitKey, topY, walkOn = 0.3) {
    for (let k = 0; k <= 2.4; k += 0.2) {
      const r = climbOnce(start, intoWallKey, exitKey, topY, k, walkOn);
      if (r.grounded && Math.abs(r.end[1] - topY) < 0.05) return { ...r, exitAt: r2(k) };
    }
    return { failed: true };
  }
  // run forward, jump past `takeoff` (distance along the facing direction), optionally air-dash, stop on landing
  function gap(start, yaw, takeoff, useDash) {
    place(...start, yaw);
    hold('KeyW');
    const fwd = [-Math.sin(yaw), -Math.cos(yaw)];
    const prog = () => me.pos.x * fwd[0] + me.pos.z * fwd[1];
    const y0 = me.pos.y;
    let jumped = false, dashed = false;
    run(3, () => {
      if (!jumped && me.grounded && prog() > takeoff) { jump(); jumped = true; return; }
      if (useDash && jumped && !dashed && me.pos.y > y0 + 0.4) { me.dash(); dashed = true; }
      if (jumped && me.grounded) { me.keys.clear(); return false; }
    });
    return where();
  }
  // stand on a jump pad, steer toward the target once above it, stop on landing
  function pad(padIdx, steerKeys, targetY) {
    if (padIdx < 0) return { failed: true, reason: 'no such pad' };
    const [x, y, z] = MAP.pads[padIdx];
    place(x, y, z);
    let peak = 0, steering = false;
    run(4, () => {
      peak = Math.max(peak, me.pos.y);
      if (!steering && me.pos.y > targetY + 0.3) { steering = true; hold(...steerKeys); }
      if (steering && me.grounded) { me.keys.clear(); return false; }
    });
    return { peak: r2(peak), ...where() };
  }
  return { me, MAP, place, hold, jump, run, climb, gap, pad, r2 };
}

export function reporter() {
  let ok = true;
  return {
    check(name, cond, info) { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`, JSON.stringify(info)); ok &&= !!cond; },
    done() { process.exit(ok ? 0 : 1); },
  };
}
