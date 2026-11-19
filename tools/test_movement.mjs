// Headless check of dash + wall jump physics (node tools/test_movement.mjs)
import * as THREE from 'three';
import { LocalPlayer } from '../public/js/player.js';
import { MAP, buildColliders } from '../public/js/shared.js';

const cam = new THREE.PerspectiveCamera();
const me = new LocalPlayer(cam, buildColliders(MAP));
const step = (sec, input = {}) => { for (let t = 0; t < sec; t += 1 / 60) { me.physics(1 / 60, input); me.updateCamera(1 / 60); } };
const r = v => +v.toFixed(2);
let ok = true;
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`, info); ok &&= cond; };

// dash forward from standing
me.spawn([-30, 0, 5], -Math.PI / 2); step(0.2);
let x0 = me.pos.x; check('dash fires', me.dash(), ''); step(0.5);
check('dash moves ~3m forward (+x)', me.pos.x - x0 > 2.5, { moved: r(me.pos.x - x0) });

// unlimited: chain dashes after the short cooldown
let count = 0; x0 = me.pos.x;
for (let i = 0; i < 6; i++) { if (me.dash()) count++; step(0.4); }
check('6 dashes in a row (no charges)', count === 6, { count, moved: r(me.pos.x - x0) });
check('cannot double-dash instantly', (me.dash(), !me.dash()), '');

// strafe dash goes sideways
me.spawn([-30, 0, 0], -Math.PI / 2); step(0.4); // let the previous dash cooldown finish
me.keys.add('KeyD'); const z0 = me.pos.z; me.dash(); step(0.3); me.keys.delete('KeyD');
check('D+dash goes right (+z when facing +x)', me.pos.z - z0 > 2, { dz: r(me.pos.z - z0) });

// air dash keeps you up briefly
me.spawn([-30, 0, -3], -Math.PI / 2); step(0.2);
me.keys.add('Space'); step(1 / 60); me.keys.delete('Space'); step(0.2);
const yAir = me.pos.y; me.dash(); step(0.1);
check('air dash works', me.pos.y > 0.5 && me.vel.length() > 10, { y: r(me.pos.y), speed: r(me.vel.length()), yBefore: r(yAir) });

// wall jump: stand against the lane divider (its south face is at z=9.6), jump, press jump again
me.spawn([-20, 0, 9.25], -Math.PI / 2); step(0.3);
me.keys.add('Space'); step(1 / 60); me.keys.delete('Space'); step(0.15);
const before = { y: r(me.pos.y), vy: r(me.vel.y), vz: r(me.vel.z) };
me.jumpQueued = true; step(1 / 60);
check('wall jump kicks up and away from wall (-z)', me.vel.y > 5 && me.vel.z < -4, { before, after: { y: r(me.pos.y), vy: r(me.vel.y), vz: r(me.vel.z) } });

// chain wall jumps in the narrow gap behind the A choke wall (between z=28 wall end... use corridor x=0 wall)
me.spawn([-0.85, 0, 22], -Math.PI / 2); step(0.3);
me.keys.add('Space'); step(1 / 60); me.keys.delete('Space'); step(0.15);
let peak = 0, jumps = 0;
for (let i = 0; i < 4; i++) {
  me.pos.x = -0.85; // drift back to the wall each time (as a player would steer)
  me.jumpQueued = true; const vyBefore = me.vel.y; step(1 / 60); if (me.vel.y > vyBefore + 3) jumps++;
  step(0.25); peak = Math.max(peak, me.pos.y);
}
check('repeated wall jumps climb higher than one jump', jumps >= 3 && peak > 2, { jumps, peak: r(peak) });

// no wall jump in open air
me.spawn([-30, 0, -6], -Math.PI / 2); step(0.2);
me.keys.add('Space'); step(1 / 60); me.keys.delete('Space'); step(0.15);
const vy0 = me.vel.y; me.jumpQueued = true; step(1 / 60);
check('no wall jump without a wall', me.vel.y < vy0, { vy0: r(vy0), vy: r(me.vel.y) });

process.exit(ok ? 0 : 1);
