// Trenchline movement checks with the real physics.  Run: node tools/test_trenchline.mjs
import { createRig, reporter } from './parkour-rig.mjs';
import { WEAPONS } from '../public/js/shared.js';

const { me, place, hold, jump, run, gap, r2 } = createRig('trenchline');
const { check, done } = reporter();

// trench -> berm: berms are 1.4 m, a normal jump gets you up
let r = gap([-21, 0, 11.4], 0, -10.6, false);   // in the trench at z 10..12, run north-south toward berm B1 (z 1.5..10)
check('jump out of a trench onto a 1.4 m berm', r.grounded && Math.abs(r.end[1] - 1.4) < 0.05, r);

// berms are NOT walk-up-able: you can't just run onto them without jumping
place(-21, 0, 11.4); hold('KeyW'); run(1.2);
check('cannot walk onto a berm without jumping', me.pos.y < 0.5, { y: r2(me.pos.y) });

// grenade jump: a grenade at your feet throws you onto the 2.9 m bunker roof
const W = WEAPONS.grenade;
place(0, 0, 4.2);                                  // just north of the centre bunker (roof z -3.2..3.2, top 2.9)
const k = W.knock;                                 // full knockback at the centre of the blast
me.vel.y = Math.max(me.vel.y, 0) + k * 0.75 + 2; me.grounded = false;
hold('KeyW');                                       // steer toward the bunker (-z)
let peak = 0;
run(2, () => { peak = Math.max(peak, me.pos.y); if (me.grounded && me.pos.y > 0.5) return false; });
check('grenade-jump onto the bunker roof', me.grounded && Math.abs(me.pos.y - 2.9) < 0.05, { peak: r2(peak), end: [r2(me.pos.x), r2(me.pos.y), r2(me.pos.z)] });
done();
