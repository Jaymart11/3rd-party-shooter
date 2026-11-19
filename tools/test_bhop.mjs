// Bunny hop, air strafing and crouch jumping with the real physics.  Run: node tools/test_bhop.mjs
import { createRig, reporter } from './parkour-rig.mjs';
import { MAPS } from '../public/js/shared.js';

// an empty test field so nothing gets in the way of the speed runs
const R = Math.PI / 2;
MAPS.testfield = { name: 'Test field', half: { x: 200, z: 200 }, boxes: [], props: [], spawns: { atk: [[0, 0, -R]], def: [[0, 0, R]] },
  sites: { A: [0, 0], B: [0, 0] }, defend: { A: [[0, 0]], B: [[0, 0]] }, roam: [[0, 0]] };
const { me, place, hold, run, r2 } = createRig('testfield');
const { check, done } = reporter();
const hs = () => Math.hypot(me.vel.x, me.vel.z);

// 1. holding Space bunny hops without losing speed on landing (facing +x)
place(0, 0, 0, -R);
hold('KeyW'); run(0.6);                      // reach running speed
const runSpeed = hs();
me.keys.add('Space');
let minLanding = 99, landings = 0, wasAir = false;
run(2.5, () => {
  if (!me.grounded) wasAir = true;
  else if (wasAir) { landings++; wasAir = false; minLanding = Math.min(minLanding, hs()); }
});
check('bunny hop keeps speed through landings', landings >= 3 && minLanding > runSpeed * 0.97,
  { runSpeed: r2(runSpeed), minSpeedAtLanding: r2(minLanding), landings });

// 2. air strafing: hold Space + D and turn right smoothly -> speed builds above running speed
place(0, 0, 0, -R);
hold('KeyW'); run(0.5);
hold('KeyD', 'Space');
let top = 0;
run(4, () => { me.yaw -= 2.1 / 60; top = Math.max(top, hs()); });
check('air strafing gains speed', top > runSpeed * 1.35, { runSpeed: r2(runSpeed), topSpeed: r2(top) });
check('bhop speed is capped', top <= 13.01, { topSpeed: r2(top) });

// 3. crouch jump: Updraft's 2 m perch is too high for a plain jump but not for a crouch jump
const up = createRig('updraft');
function perchAttempt(crouch) {
  up.place(-18.5, 0, 8, -R);                 // west of the perch (x -15.5..-12.5, top 2.0), facing +x
  up.hold('KeyW');
  let jumped = false, tucked = false;
  up.run(2, () => {
    if (!jumped && up.me.grounded && up.me.pos.x > -17.2) { up.me.keys.add('Space'); jumped = true; return; }
    if (jumped) up.me.keys.delete('Space');
    if (crouch && jumped && !tucked && up.me.vel.y < 2.5) { up.me.keys.add('KeyC'); tucked = true; }
    if (jumped && up.me.grounded && up.me.pos.x > -15.6) return false;
  });
  return { y: up.r2(up.me.pos.y), x: up.r2(up.me.pos.x), crouched: up.me.crouch };
}
const plain = perchAttempt(false), cj = perchAttempt(true);
check('plain jump can NOT reach the 2 m perch', plain.y < 1, plain);
check('crouch jump reaches the 2 m perch', Math.abs(cj.y - 2) < 0.05, cj);

// 4. you can jump while crouched
place(0, 0, 0, -R);
hold('KeyC'); run(0.3);
me.keys.add('Space'); run(1 / 60);
check('jump while crouched', me.vel.y > 5, { vy: r2(me.vel.y), crouch: me.crouch });
done();
