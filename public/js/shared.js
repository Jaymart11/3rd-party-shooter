// Shared between the Node server and the browser client: map layout, weapons, teams, ray tests.

export const TEAMS = {
  atk: { name: 'Attackers', color: '#ff5a4e', tint: [1.0, 0.5, 0.42] },
  def: { name: 'Defenders', color: '#47c2ff', tint: [0.3, 0.5, 1.0] },
};

export const WEAPONS = {
  rifle: {
    name: 'Vanguard AR', slot: 1, mag: 25, reserve: 75, fireInterval: 0.1, auto: true, reload: 2.2, range: 220,
    damage: { head: 140, body: 38, legs: 32 },
    spread: { base: 0.0025, move: 0.035, air: 0.1, bloom: 0.011, maxBloom: 0.05, recover: 0.12 },
    recoil: 0.013, model: 'rifle.glb',
  },
  pistol: {
    name: 'Sidewinder P9', slot: 2, mag: 12, reserve: 36, fireInterval: 0.16, auto: false, reload: 1.5, range: 140,
    damage: { head: 78, body: 26, legs: 22 },
    spread: { base: 0.003, move: 0.018, air: 0.06, bloom: 0.02, maxBloom: 0.04, recover: 0.09 },
    recoil: 0.022, model: 'pistol.glb',
  },
  sniper: {
    name: 'Longbow SR', slot: 1, mag: 5, reserve: 20, fireInterval: 1.3, auto: false, reload: 3.0, range: 320,
    damage: { head: 255, body: 150, legs: 120 },   // one shot anywhere above the knees
    // terrible from the hip, pin-point when scoped and still
    spread: { base: 0.0006, move: 0.06, air: 0.15, bloom: 0, maxBloom: 0, recover: 1, hip: 0.07 },
    recoil: 0.06, scope: true, scopeFov: 16, speedMul: 0.85, model: 'sniper.glb',
  },
  knife: {
    name: 'Tactical Knife', slot: 3, melee: true, mag: 0, reserve: 0, fireInterval: 0.42, heavyInterval: 0.95,
    auto: true, reload: 0, range: 2.4,
    damage: { light: 50, heavy: 100 }, backstabMul: 1.5,   // light 50 / heavy 100, x1.5 from behind
    spread: { base: 0, move: 0, air: 0, bloom: 0, maxBloom: 0, recover: 1 },
    recoil: 0, speedMul: 1.15, model: 'knife.glb',
  },
  grenade: {
    name: 'Frag Grenade', slot: 1, throwable: true, mag: 0, reserve: 0, fireInterval: 0.9, auto: false, reload: 0, range: 0,
    fuse: 1.6,            // seconds from throw to explosion (it bounces and rolls meanwhile)
    radius: 6,            // blast radius in metres; damage falls off linearly to the edge
    damage: { max: 120 }, selfMul: 0.5,
    knock: 13,            // knockback speed at the centre: grenade-jumping works
    throwSpeed: 17, lobSpeed: 9,
    spread: { base: 0, move: 0, air: 0, bloom: 0, maxBloom: 0, recover: 1 },
    recoil: 0, speedMul: 1.05, model: 'grenade.glb',
  },
};

// Server-wide game modes: which weapons everyone gets (keys 1-4 follow this order).
export const MODES = {
  standard: { name: 'Standard', weapons: ['rifle', 'sniper', 'pistol', 'knife'] },
  ar: { name: 'AR Only', weapons: ['rifle', 'knife'] },
  sniper: { name: 'Snipers Only', weapons: ['sniper', 'knife'] },
  knife: { name: 'Knife Only', weapons: ['knife'] },
  grenade: { name: 'Grenades Only', weapons: ['grenade'] },
};
export const modeWeapons = mode => (MODES[mode] || MODES.standard).weapons;

// Native size (metres) of each downloaded Poly Haven model, measured from its glTF bounds.
export const PROP_DIMS = {
  barrel_03: [0.634, 0.93, 0.639],
  concrete_road_barrier: [1.545, 0.831, 0.639],
  wooden_crate_02: [0.529, 0.464, 1.166],
  wooden_military_crate: [1.242, 0.465, 0.52],
  utility_box_01: [0.52, 1.12, 0.432],
};

const R = Math.PI / 2;

const YARD = {
  name: 'Dustline Yard',
  // ground-level spots the bots use
  sites: { A: [26, 21], B: [26, -20] },
  defend: { A: [[36, 15], [30, 25.5], [24.5, 14.5], [37, 12.5]], B: [[34, -13], [27, -21], [36, -26], [23, -12.5]] },
  roam: [[0, -6], [0, 6], [-20, 0], [20, 0], [-20, 20], [-20, -20], [14, 21], [14, -21], [-6, 27], [-6, -27], [26, 22], [26, -20], [30, 0], [-30, 0]],
  wallHeight: 7,
  half: { x: 50, z: 30 },
  // [centreX, bottomY, centreZ, width(x), height(y), depth(z), material]
  boxes: [
    // outer walls
    [0, 0, 30.5, 102, 7, 1, 'wall'], [0, 0, -30.5, 102, 7, 1, 'wall'],
    [-50.5, 0, 0, 1, 7, 62, 'wall'], [50.5, 0, 0, 1, 7, 62, 'wall'],
    // lane dividers with a gap in the middle for rotations
    [-20, 0, 10, 28, 4.5, 0.8, 'brick'], [18, 0, 10, 24, 4.5, 0.8, 'brick'],
    [-20, 0, -10, 28, 4.5, 0.8, 'brick'], [18, 0, -10, 24, 4.5, 0.8, 'brick'],
    [-20, 4.5, 10, 28.2, 0.18, 1.0, 'floor'], [18, 4.5, 10, 24.2, 0.18, 1.0, 'floor'],
    [-20, 4.5, -10, 28.2, 0.18, 1.0, 'floor'], [18, 4.5, -10, 24.2, 0.18, 1.0, 'floor'],
    // mid platform with steps on both sides
    [0, 0, 0, 5, 1.2, 5, 'floor'],
    [-2.9, 0, 0, 0.8, 0.8, 2.2, 'floor'], [-3.7, 0, 0, 0.8, 0.4, 2.2, 'floor'],
    [2.9, 0, 0, 0.8, 0.8, 2.2, 'floor'], [3.7, 0, 0, 0.8, 0.4, 2.2, 'floor'],
    [0, 1.2, 0, 0.4, 1.0, 3, 'wall'],
    // mid cover
    [-14, 0, 3, 0.8, 3, 5, 'wall'], [14, 0, -3, 0.8, 3, 5, 'wall'],
    [-24, 0, -4, 4, 2.2, 0.8, 'wall'], [24, 0, 4, 4, 2.2, 0.8, 'wall'],
    // spawn cover
    [-38, 0, 0, 0.8, 2.5, 8, 'wall'], [40, 0, 0, 0.8, 2.5, 8, 'wall'],
    // A lane: choke wall, A heaven platform + stairs, site wall
    [0, 0, 22, 1, 4.5, 12, 'brick'],
    [38, 0, 24, 8, 2.0, 10, 'floor'],
    [33.7, 0, 27, 0.6, 1.6, 2, 'floor'], [33.1, 0, 27, 0.6, 1.2, 2, 'floor'],
    [32.5, 0, 27, 0.6, 0.8, 2, 'floor'], [31.9, 0, 27, 0.6, 0.4, 2, 'floor'],
    [34.1, 2.0, 22, 0.2, 1.0, 6, 'wall'],
    [22, 0, 20, 0.8, 3, 6, 'wall'],
    // B lane: choke wall + B hut with doors and roof
    [0, 0, -22, 1, 4.5, 12, 'brick'],
    [22.5, 0, -16, 3, 3.5, 0.5, 'brick'], [29, 0, -16, 4, 3.5, 0.5, 'brick'],
    [26, 0, -24, 10, 3.5, 0.5, 'brick'],
    [21, 0, -22.5, 0.5, 3.5, 3, 'brick'], [21, 0, -17, 0.5, 3.5, 2, 'brick'],
    [31, 0, -22.5, 0.5, 3.5, 3, 'brick'], [31, 0, -17, 0.5, 3.5, 2, 'brick'],
    [26, 3.5, -20, 10.6, 0.3, 8.6, 'floor'],
  ],
  // [model, x, y, z, rotationDegrees (multiple of 90), scale]
  props: [
    // mid
    ['wooden_crate_02', -8, 0, 4, 0, 2.2], ['wooden_crate_02', 8, 0, -4, 0, 2.2],
    ['barrel_03', -6, 0, -5, 0, 1.15], ['barrel_03', -5.2, 0, -5.9, 0, 1.15], ['barrel_03', 6, 0, 5.5, 0, 1.15],
    ['concrete_road_barrier', -18, 0, -6, 0, 1.3], ['concrete_road_barrier', 18, 0, 6, 0, 1.3],
    // A
    ['wooden_military_crate', 26, 0, 14, 0, 2], ['wooden_military_crate', 26, 0.93, 14, 0, 2],
    ['wooden_crate_02', 30, 0, 22, 90, 2.2],
    ['concrete_road_barrier', 14, 0, 18, 90, 1.3], ['concrete_road_barrier', 14, 0, 25, 90, 1.3],
    ['barrel_03', -6, 0, 27, 0, 1.15], ['barrel_03', -10, 0, 14, 0, 1.15],
    ['wooden_crate_02', -20, 0, 20, 90, 2.2], ['concrete_road_barrier', -30, 0, 15, 0, 1.3],
    // B
    ['wooden_military_crate', 26, 0, -12.5, 0, 2],
    ['wooden_crate_02', 35, 0, -20, 0, 2.2], ['wooden_crate_02', 35, 1.021, -20, 0, 2.2],
    ['barrel_03', 23.5, 0, -22.6, 0, 1.15], ['wooden_crate_02', 28.3, 0, -21.6, 90, 2.2],
    ['concrete_road_barrier', 14, 0, -18, 90, 1.3], ['concrete_road_barrier', -20, 0, -20, 90, 1.3],
    ['wooden_military_crate', -28, 0, -15, 90, 2],
    // spawns
    ['wooden_military_crate', -44, 0, 9, 0, 2], ['barrel_03', -47, 0, -9, 0, 1.15],
    ['wooden_military_crate', 44, 0, -9, 0, 2], ['barrel_03', 47, 0, 9, 0, 1.15],
    ['utility_box_01', -49.6, 0, 20, 270, 1.6], ['utility_box_01', 49.6, 0, -20, 90, 1.6],
  ],
  spawns: {
    atk: [[-45, 0, -R], [-45, 3, -R], [-45, -3, -R], [-45, 6, -R], [-45, -6, -R], [-47.5, 1.5, -R], [-47.5, -1.5, -R]],
    def: [[45, 0, R], [45, 3, R], [45, -3, R], [45, 6, R], [45, -6, R], [47.5, 1.5, R], [47.5, -1.5, R]],
  },
};

// ---------------------------------------------------------------- Updraft: a vertical parkour arena
// Built as one quarter (x<0, z>0) and mirrored four ways so both teams get identical routes.
// Orange 'jump' surfaces mark walls meant for wall-jumping.
function mirror4(list, xi, zi) {
  const out = [], seen = new Set();
  for (const item of list) {
    for (const [fx, fz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const c = [...item]; c[xi] = item[xi] * fx; c[zi] = item[zi] * fz;
      const key = JSON.stringify(c);
      if (!seen.has(key)) { seen.add(key); out.push(c); }
    }
  }
  return out;
}

const UPDRAFT_QUARTER = [
  // corner tower (6 m) with a 2 m wall-jump chimney cut into the side facing the middle
  [-26.5, 0, 16, 3, 6, 8, 'brick'], [-21.5, 0, 16, 3, 6, 8, 'brick'], [-24, 0, 17.5, 2, 6, 5, 'brick'],
  [-24.95, 0, 13.5, 0.1, 6, 3, 'jump'], [-23.05, 0, 13.5, 0.1, 6, 3, 'jump'],
  // jump staircase up the tower's back (1 m steps) for players who don't wall-jump
  [-20.7, 0, 21.75, 1.4, 1, 2.5, 'floor'], [-22.1, 0, 21.75, 1.4, 2, 2.5, 'floor'], [-23.5, 0, 21.75, 1.4, 3, 2.5, 'floor'],
  [-24.9, 0, 21.75, 1.4, 4, 2.5, 'floor'], [-26.3, 0, 21.75, 1.4, 5, 2.5, 'floor'],
  // rooftop bridge toward the middle: first gap is a jump, second needs a dash
  [-16.5, 5.7, 16, 3.5, 0.3, 2.4, 'floor'], [-16.5, 0, 16, 0.5, 5.7, 0.5, 'wall'],
  [-9.5, 5.7, 16, 3, 0.3, 2.4, 'floor'], [-9.5, 0, 16, 0.5, 5.7, 0.5, 'wall'],
  // high platform over the middle lane, climbed through a fin chimney on its outer side
  [0, 5.7, 16, 8, 0.3, 4, 'floor'], [0, 0, 16, 1, 5.7, 1, 'wall'], [-1.2, 0, 20, 0.4, 6, 4, 'jump'],
  // wall-jump alley: two tall parallel fins you can bounce between or run along the top of
  [-12, 0, 22.5, 10, 6, 0.6, 'jump'], [-12, 0, 25.1, 10, 6, 0.6, 'jump'],
  // walkways on top of the fins so you can land after climbing out (and hop over to the rooftop bridges)
  [-12, 5.7, 27.4, 10, 0.3, 5.2, 'floor'], [-12, 5.7, 21.2, 10, 0.3, 2.2, 'floor'],
  // centre tower (7 m) with chimneys on both team sides
  [0, 0, 2, 6, 7, 2, 'brick'], [0, 0, 0, 1, 7, 2, 'brick'], [-1.75, 0, 0.95, 2.5, 7, 0.1, 'jump'],
  // mid-height perches
  [-14, 0, 8, 3, 2, 3, 'floor'], [-6, 0, 6, 2.5, 3, 2.5, 'floor'], [-6, 0, 8.6, 4, 5, 0.5, 'jump'],
  // ground cover
  [-30, 0, 4, 0.8, 2.2, 4, 'wall'], [-18, 0, 2, 4, 1.2, 0.8, 'wall'], [-35, 0, 10, 2.5, 1.5, 2.5, 'floor'],
  [-37, 0, 0, 0.8, 2.5, 8, 'wall'],
];

const UPDRAFT = {
  name: 'Updraft',
  half: { x: 45, z: 30 },
  wallHeight: 10,
  boxes: [
    [0, 0, 30.5, 92, 10, 1, 'wall'], [0, 0, -30.5, 92, 10, 1, 'wall'],
    [-45.5, 0, 0, 1, 10, 62, 'wall'], [45.5, 0, 0, 1, 10, 62, 'wall'],
    ...mirror4(UPDRAFT_QUARTER, 0, 2),
  ],
  props: mirror4([
    ['wooden_crate_02', -14, 0, 11, 90, 2.2],   // step up onto the 2 m perch
    ['concrete_road_barrier', -24, 0, 6, 0, 1.3], ['barrel_03', -10, 0, 3, 0, 1.15],
    ['wooden_military_crate', -32, 0, 18, 90, 2], ['barrel_03', -40, 0, 12, 0, 1.15],
  ], 1, 3),
  spawns: {
    atk: [[-41, 0, -R], [-41, 3, -R], [-41, -3, -R], [-41, 6, -R], [-41, -6, -R], [-43, 1.5, -R], [-43, -1.5, -R]],
    def: [[41, 0, R], [41, 3, R], [41, -3, R], [41, 6, R], [41, -6, R], [43, 1.5, R], [43, -1.5, R]],
  },
  sites: { A: [18, 8], B: [18, -8] },
  defend: { A: [[22, 6], [14, 10], [26, 9], [30, 4]], B: [[22, -6], [14, -10], [26, -9], [30, -4]] },
  roam: [[0, 8], [0, -8], [-12, 0], [12, 0], [-20, 8], [20, -8], [-12, 18], [12, -18], [0, 24], [0, -24], [-30, 0], [30, 0]],
};

// ---------------------------------------------------------------- Pinnacle: 3x the height of Updraft
// Corner towers rise in three 6 m stages (18 m) and a centre spire reaches 20 m. Every stage has a
// wall-jump chimney and a jump pad, with ledges to rest on between stages. A sky course of floating
// platforms at 12 m links the towers to the spire, with gaps that need a dash.

// A block with a 2 m wall-jump notch cut into one face ('+x', '-x', '+z' or '-z').
function notched(cx, cz, w, d, y, h, face, depth = 3, mat = 'brick') {
  const nw = 2;
  const alongX = face[1] === 'z';           // a notch on a z face is 2 m wide along x
  const U = alongX ? w : d, Vd = alongX ? d : w;
  const nd = Math.min(depth, Vd - 1);
  const sign = face[0] === '+' ? 1 : -1;
  const cu = alongX ? cx : cz, cv = alongX ? cz : cx;
  const out = [];
  const add = (u0, u1, v0, v1, m = mat) => {
    const [x0, x1, z0, z1] = alongX ? [u0, u1, v0, v1] : [v0, v1, u0, u1];
    out.push([(x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0, h, z1 - z0, m]);
  };
  const vMin = cv - Vd / 2, vMax = cv + Vd / 2;
  const vLo = sign > 0 ? vMax - nd : vMin, vHi = sign > 0 ? vMax : vMin + nd;
  add(cu - U / 2, cu - nw / 2, vMin, vMax);
  add(cu + nw / 2, cu + U / 2, vMin, vMax);
  if (sign > 0) add(cu - nw / 2, cu + nw / 2, vMin, vLo); else add(cu - nw / 2, cu + nw / 2, vHi, vMax);
  add(cu - nw / 2, cu - nw / 2 + 0.1, vLo, vHi, 'jump');   // orange wall-jump faces
  add(cu + nw / 2 - 0.1, cu + nw / 2, vLo, vHi, 'jump');
  return out;
}

const launch = h => +Math.sqrt(2 * 20 * (h + 2)).toFixed(2); // pad speed that clears h metres with 2 m to spare (gravity 20)

// Plan view of one corner tower (x<0, z>0). Each stage sits in the far corner of the one below, so every
// chimney opens onto a free ledge instead of being capped by the next stage.
//   stage 1: 12x12, 6 m,  chimney on its south face   (x -32..-20, z 9..21)
//   stage 2:  8x8, 12 m,  chimney facing east          (x -32..-24, z 13..21)
//   stage 3:  4x5, 18 m,  shallow chimney facing south (x -32..-28, z 16..21)
const PINNACLE_QUARTER = [
  ...notched(-26, 15, 12, 12, 0, 6, '-z'),
  ...notched(-28, 17, 8, 8, 6, 6, '+x'),
  ...notched(-30, 18.5, 4, 5, 12, 6, '-z', 2),
  // sky course at 12 m: tower stage 2 -> P1 -> (dash) P2 -> (dash) P3 -> (dash) P5 -> (dash) spire
  // (the course runs along z 13..16, stage 2's south strip, so you never run into its chimney hole)
  [-20, 11.7, 14.5, 3, 0.3, 3, 'floor'], [-19, 0, 14.5, 0.5, 11.7, 0.5, 'wall'],
  [-13, 11.7, 14.5, 3, 0.3, 3, 'floor'], [-13, 0, 14.5, 0.5, 11.7, 0.5, 'wall'],
  [-6, 11.7, 14.5, 3, 0.3, 3, 'floor'], [-6, 0, 14.5, 0.5, 11.7, 0.5, 'wall'],
  [0, 11.7, 10, 7, 0.3, 3, 'floor'], [-2.5, 0, 10, 0.5, 11.7, 0.5, 'wall'],
  // centre spire, stage 1 (14 x 14, 6 m) with chimneys on both team sides
  [0, 0, 4, 14, 6, 6, 'brick'], [0, 0, 0, 9, 6, 2, 'brick'], [-5.75, 0, 0.95, 2.5, 6, 0.1, 'jump'],
  // stage 2 (8 x 8, 12 m) with chimneys facing north and south
  [-2.5, 6, 0, 3, 6, 8, 'brick'], [0, 6, 0, 2, 6, 3, 'brick'], [-0.95, 6, 2.75, 0.1, 6, 2.5, 'jump'],
  // stage 3: the 20 m peak (pads only)
  [0, 12, 0, 4, 8, 4, 'brick'],
  // TALL WALLS
  // spine chimney: an 18 m fin behind the corner tower, climbing its back wall all the way to the top
  [-34.3, 0, 18.5, 0.6, 18, 4, 'jump'], [-32.05, 0, 18.5, 0.1, 18, 4, 'jump'],
  // sky alley: two 18 m fins with a ridge walkway on top running along the outer wall
  [-12, 0, 22.3, 12, 18, 0.6, 'jump'], [-12, 0, 24.9, 12, 18, 0.6, 'jump'],
  [-18.5, 17.7, 26.3, 25, 0.3, 3.4, 'floor'],
  // monoliths: tall cover so players up high can't see the whole ground floor
  [-14, 0, 5, 0.8, 10, 5, 'wall'], [-22, 0, 3, 5, 9, 0.8, 'wall'],
  // MIDDLE WALLS around the spire
  // mid-gate chimney: two 12 m walls either side of the centre lane, with a walkway on top that
  // bridges straight onto the spire's 12 m stage
  [-9, 0, 2.7, 0.6, 12, 3, 'jump'], [-11.4, 0, 2.7, 0.6, 12, 3, 'jump'],
  [-6.9, 11.7, 2.7, 4.8, 0.3, 3, 'floor'],
  // lane blockers: 20 m climbing walls across the centre lane (also stop spawn seeing down the middle).
  // Spam wall jump + dash (Q) back into the wall to climb a single wall like this.
  [-18, 0, 0, 0.8, 20, 4, 'jump'],
  // inner monoliths beside the sky course, 16 m climbing walls
  [-10, 0, 9.5, 4, 16, 0.8, 'jump'],
  // ground cover
  [-20, 0, 6, 4, 1.2, 0.8, 'wall'], [-30, 0, 4, 2.5, 1.5, 2.5, 'floor'],
  [-32, 0, 0, 0.8, 2.5, 8, 'wall'],
];

// jump pads: [x, y, z, radius, launch speed]
const PINNACLE_PADS = [
  [-19.2, 0, 19.5, 0.7, launch(6)],      // ground -> tower stage 1 roof
  [-23.2, 6, 12.2, 0.7, launch(6)],      // stage 1 -> stage 2 (right by its corner)
  [-27.2, 12, 15.2, 0.6, launch(6)],     // stage 2 -> 18 m top (right by its corner)
  [-17.3, 0, 14.5, 0.7, launch(12.2)],   // ground -> sky course (P1); beside it, not under it
  [-5.5, 6, 5.5, 0.7, launch(6)],        // spire stage 1 -> 2
  [-3, 12, -1, 0.6, launch(8)],          // spire stage 2 -> 20 m peak (mid-edge, away from where the 6 m pads drop you)
];

const PINNACLE = {
  name: 'Pinnacle',
  half: { x: 40, z: 28 },
  wallHeight: 26,
  boxes: [
    [0, 0, 28.5, 82, 26, 1, 'wall'], [0, 0, -28.5, 82, 26, 1, 'wall'],
    [-40.5, 0, 0, 1, 26, 58, 'wall'], [40.5, 0, 0, 1, 26, 58, 'wall'],
    ...mirror4(PINNACLE_QUARTER, 0, 2),
  ],
  pads: mirror4(PINNACLE_PADS, 0, 2),
  props: mirror4([
    ['wooden_crate_02', -24, 0, 6, 0, 2.2], ['concrete_road_barrier', -10, 0, 8, 90, 1.3],
    ['barrel_03', -36, 0, 10, 0, 1.15], ['wooden_military_crate', -22, 0, 24.5, 0, 2],
  ], 1, 3),
  spawns: {
    atk: [[-36, 0, -R], [-36, 3, -R], [-36, -3, -R], [-36, 6, -R], [-36, -6, -R], [-38, 1.5, -R], [-38, -1.5, -R]],
    def: [[36, 0, R], [36, 3, R], [36, -3, R], [36, 6, R], [36, -6, R], [38, 1.5, R], [38, -1.5, R]],
  },
  sites: { A: [16, 10], B: [16, -10] },
  defend: { A: [[20, 8], [12, 12], [24, 6], [28, 3]], B: [[20, -8], [12, -12], [24, -6], [28, -3]] },
  roam: [[-10, 12], [10, -12], [-12, 0], [12, 0], [-20, 10], [20, -10], [0, 22], [0, -22], [-26, 0], [26, 0]],
};

// ---------------------------------------------------------------- Trenchline: built for grenades
// A compact arena of chest-high earth berms (1.4 m, you can jump onto them) cut by a network of trenches.
// Trenches hide you from direct fire but grenades bounce and roll into them; standing on a berm is exposed.
// A slit-window bunker sits in the middle courtyard. Short sightlines, lots of bank shots.
const TRENCH_QUARTER = [
  // berms (raised ground) with 2 m trenches between them
  [-21, 0, 5.75, 10, 1.4, 8.5, 'floor'], [-21, 0, 15, 10, 1.4, 6, 'floor'],
  [-9.5, 0, 5.75, 9, 1.4, 8.5, 'floor'], [-9.5, 0, 15, 9, 1.4, 6, 'floor'],
  // low parapets on the berm edges facing the middle (extra cover when you're up top)
  [-5.3, 1.4, 5.75, 0.4, 0.8, 6, 'wall'], [-16.3, 1.4, 15, 0.4, 0.8, 4, 'wall'],
  // bank-shot walls in the central courtyard
  [-4, 0, 8, 0.4, 3, 3, 'wall'], [-2.5, 0, 14.5, 3, 2.6, 0.4, 'wall'],
  // trench-corner blast walls
  [-15, 0, 11, 1.2, 2.2, 0.4, 'brick'], [-27.5, 0, 11, 0.4, 2.2, 2, 'brick'],
  // centre bunker: walls with doors facing each team, slit windows north/south, and a roof
  [-3, 0, 2, 0.4, 2.6, 2, 'brick'],
  [-1.5, 0, 3, 3, 1.1, 0.4, 'brick'], [-1.5, 1.7, 3, 3, 0.9, 0.4, 'brick'],
  [0, 2.6, 0, 6.4, 0.3, 6.4, 'floor'],
];

const TRENCHLINE = {
  name: 'Trenchline',
  half: { x: 30, z: 20 },
  wallHeight: 6,
  boxes: [
    [0, 0, 20.5, 62, 6, 1, 'wall'], [0, 0, -20.5, 62, 6, 1, 'wall'],
    [-30.5, 0, 0, 1, 6, 42, 'wall'], [30.5, 0, 0, 1, 6, 42, 'wall'],
    ...mirror4(TRENCH_QUARTER, 0, 2),
  ],
  props: mirror4([
    ['wooden_crate_02', -15, 0, 4, 0, 2.2], ['barrel_03', -20, 0, 19, 0, 1.15],
    ['wooden_military_crate', -10, 0, 11, 0, 2], ['concrete_road_barrier', -2.6, 0, 18.8, 0, 1.3],
  ], 1, 3),
  spawns: {
    atk: [[-28, 0, -R], [-28, 3, -R], [-28, -3, -R], [-28, 6, -R], [-28, -6, -R], [-28, 9, -R], [-28, -9, -R]],
    def: [[28, 0, R], [28, 3, R], [28, -3, R], [28, 6, R], [28, -6, R], [28, 9, R], [28, -9, R]],
  },
  sites: { A: [15, 11], B: [15, -11] },
  defend: { A: [[15, 15], [15, 6], [22, 11], [8, 11]], B: [[15, -15], [15, -6], [22, -11], [8, -11]] },
  roam: [[0, 8], [0, -8], [-15, 0], [15, 0], [-20, 11], [20, -11], [-15, 15], [15, -15], [0, 19], [0, -19], [-28, 8], [28, -8]],
};

export const MAPS = { yard: YARD, updraft: UPDRAFT, pinnacle: PINNACLE, trenchline: TRENCHLINE };

// The active map. It is updated in place by setMap(), so every module keeps the same reference.
export const MAP = {};
export function setMap(id) {
  const src = MAPS[id] ? id : 'yard';
  for (const k of Object.keys(MAP)) delete MAP[k];
  Object.assign(MAP, MAPS[src], { id: src });
  return MAP;
}
setMap('yard');

export function propBox(prop) {
  const [m, x, y, z, rot, sc] = prop;
  const d = PROP_DIMS[m] || [1, 1, 1];
  const swap = Math.round(rot / 90) % 2 !== 0;
  const w = (swap ? d[2] : d[0]) * sc, h = d[1] * sc, dep = (swap ? d[0] : d[2]) * sc;
  return { min: [x - w / 2, y, z - dep / 2], max: [x + w / 2, y + h, z + dep / 2] };
}

export function buildColliders(map) {
  const out = [];
  for (const [cx, y, cz, w, h, d] of map.boxes) {
    out.push({ min: [cx - w / 2, y, cz - d / 2], max: [cx + w / 2, y + h, cz + d / 2] });
  }
  for (const p of map.props) out.push(propBox(p));
  return out;
}

// Ray vs axis-aligned box (slab method). Returns { t, n } or null.
export function rayBox(o, d, b) {
  let tmin = -Infinity, tmax = Infinity, axis = 0, sign = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < b.min[i] || o[i] > b.max[i]) return null;
      continue;
    }
    const inv = 1 / d[i];
    let t1 = (b.min[i] - o[i]) * inv, t2 = (b.max[i] - o[i]) * inv;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  if (tmin < 0) return { t: 0, n: [0, 1, 0] }; // origin inside
  const n = [0, 0, 0]; n[axis] = sign;
  return { t: tmin, n };
}

// Nearest hit against the ground plane and every collider.
export function rayWorld(o, d, maxT, cols) {
  let best = { t: maxT, n: null };
  if (d[1] < -1e-6) {
    const t = -o[1] / d[1];
    if (t >= 0 && t < best.t) best = { t, n: [0, 1, 0] };
  }
  for (const b of cols) {
    const h = rayBox(o, d, b);
    if (h && h.t < best.t) best = h;
  }
  return best;
}

// Smoke grenade flight, identical on server and client: returns where it comes to rest and when.
export const SMOKE = { radius: 4.2, life: 15, lift: 1.3 };
// One physics step for a thrown grenade (smoke or frag), shared by the server and every client.
// p and v are [x, y, z] arrays and are updated in place.
export function nadeStep(p, v, cols, dt) {
  v[1] -= 16 * dt;
  const prev = [p[0], p[1], p[2]];
  for (let i = 0; i < 3; i++) p[i] += v[i] * dt;
  if (p[1] < 0.05) { p[1] = 0.05; v[1] *= -0.3; v[0] *= 0.6; v[2] *= 0.6; }
  for (const b of cols) {
    if (p[0] > b.min[0] && p[0] < b.max[0] && p[1] > b.min[1] && p[1] < b.max[1] && p[2] > b.min[2] && p[2] < b.max[2]) {
      for (let i = 0; i < 3; i++) {
        if (prev[i] <= b.min[i] || prev[i] >= b.max[i]) {
          v[i] *= -0.35; p[i] = prev[i];
          if (i === 1 && prev[1] >= b.max[1]) { v[0] *= 0.6; v[2] *= 0.6; }
        }
      }
    }
  }
}
export const NADE_DT = 1 / 120;

export function simulateNade(origin, vel, cols) {
  const p = [...origin], v = [...vel];
  let t = 0;
  while (t < 2.2) {
    nadeStep(p, v, cols, NADE_DT);
    t += NADE_DT;
    if (Math.hypot(v[0], v[1], v[2]) < 0.6 && t > 0.4) break;
  }
  return { p, t };
}

// Frag grenades keep bouncing/rolling until the fuse runs out, then explode where they are.
export function simulateFrag(origin, vel, cols, fuse) {
  const p = [...origin], v = [...vel];
  for (let t = 0; t < fuse; t += NADE_DT) nadeStep(p, v, cols, NADE_DT);
  return p;
}
