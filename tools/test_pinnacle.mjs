// Every Pinnacle route must be possible with the real movement physics.  Run: node tools/test_pinnacle.mjs
import { createRig, reporter } from './parkour-rig.mjs';

const rig = createRig('pinnacle');
const { climb, gap, pad, MAP } = rig;
const { check, done } = reporter();
const at = (r, y) => !r.failed && r.grounded && Math.abs(r.end[1] - y) < 0.05;
const R = Math.PI / 2;
const padIdx = (x, y, z) => MAP.pads.findIndex(p => p[0] === x && p[1] === y && p[2] === z);

// --- corner tower chimneys (6 -> 12 -> 18 m)
let r = climb([-26, 0, 9.6], 'KeyA', 'KeyD', 6);      check('tower stage 1 chimney -> 6 m', at(r, 6), r);
r = climb([-24.6, 6, 17], 'KeyW', 'KeyS', 12);         check('tower stage 2 chimney -> 12 m', at(r, 12), r);
r = climb([-30, 12, 16.4], 'KeyA', 'KeyS', 18);        check('tower stage 3 chimney -> 18 m top', at(r, 18), r);
// --- centre spire chimneys (6 -> 12 m)
r = climb([-5.75, 0, 0], 'KeyS', 'KeyW', 6);           check('spire stage 1 chimney -> 6 m', at(r, 6), r);
r = climb([0, 6, 3.6], 'KeyA', 'KeyD', 12);            check('spire stage 2 chimney -> 12 m', at(r, 12), r);

// --- jump pads
r = pad(padIdx(-19.2, 0, 19.5), ['KeyA'], 6);          check('pad: ground -> tower 6 m', at(r, 6), r);
r = pad(padIdx(-23.2, 6, 12.2), ['KeyA', 'KeyS'], 12);     check('pad: tower 6 -> 12 m', at(r, 12), r);
r = pad(padIdx(-27.2, 12, 15.2), ['KeyA', 'KeyS'], 18);    check('pad: tower 12 -> 18 m', at(r, 18), r);
r = pad(padIdx(-17.3, 0, 14.5), ['KeyA'], 12);         check('pad: ground -> sky course P1 (12 m)', at(r, 12), r);
r = pad(padIdx(-5.5, 6, 5.5), ['KeyD', 'KeyW'], 12);   check('pad: spire 6 -> 12 m', at(r, 12), r);
r = pad(padIdx(-3, 12, -1), ['KeyD'], 20);      check('pad: spire 12 -> 20 m peak', at(r, 20), r);

// --- sky course at 12 m (facing +x is yaw -R)
r = gap([-25.5, 12, 14.5], -R, -24.6, false);          check('tower -> P1 (plain jump)', at(r, 12) && r.end[0] > -21.5, r);
r = gap([-21, 12, 14.5], -R, -19.1, false);            check('P1 -> P2 NOT makeable without dash', !at(r, 12), r);
r = gap([-21, 12, 14.5], -R, -19.1, true);             check('P1 -> P2 with dash', at(r, 12) && r.end[0] > -14.5, r);
r = gap([-14, 12, 14.5], -R, -12.1, true);             check('P2 -> P3 with dash', at(r, 12) && r.end[0] > -7.5, r);
r = gap([-6.5, 12, 15.5], -Math.PI / 4, -13.0, false);  check('P3 -> P5 (short diagonal hop)', at(r, 12), r);
r = gap([-2.5, 12, 11], 0, -9.1, true);                check('P5 -> spire 12 m with dash', at(r, 12) && r.end[2] < 4, r);

// --- tall walls
r = climb([-33.15, 0, 18.5], 'KeyA', 'KeyD', 18);       check('spine chimney: ground -> 18 m tower top', at(r, 18), r);
r = climb([-12, 0, 23.6], 'KeyW', 'KeyS', 18);          check('sky alley: ground -> 18 m ridge', at(r, 18) && r.end[2] > 24.6, r);
r = gap([-30, 18, 19.5], Math.PI, 20.4, true);          check('tower top -> ridge with dash', at(r, 18) && r.end[2] > 24.6, r);

// --- middle walls
r = climb([-10.2, 0, 2.7], 'KeyA', 'KeyD', 12);         check('mid-gate chimney -> 12 m walkway', at(r, 12) && r.end[0] > -9.3, r);
r = gap([-8, 12, 2.7], -R, -5.0, false);                check('mid-gate walkway -> spire 12 m stage', at(r, 12) && r.end[0] > -4.3, r);

// --- single-wall climbing: spam wall jump, then dash (Q) straight back into the wall, repeat
{
  const { me, place, hold, jump, run } = rig;
  place(-18.8, 0, 0, -R);               // facing +x, right against the lane blocker's west face
  hold('KeyW');
  jump();
  let peak = 0, wj = 0, dashes = 0, sinceWJ = 99;
  run(8, () => {
    peak = Math.max(peak, me.pos.y);
    sinceWJ += 1 / 60;
    if (!me.grounded && me.wallJumpCd <= 0 && me.wallNormal()) { me.jumpQueued = true; wj++; sinceWJ = 0; }
    else if (sinceWJ > 0.12 && sinceWJ < 0.2 && me.dash()) dashes++;   // Q back toward the wall
    if (me.grounded && me.pos.y > 1) return false;
  });
  check('wall jump + dash spam climbs a single 20 m wall', peak > 18, { peak: +peak.toFixed(1), wallJumps: wj, dashes });
}
done();
