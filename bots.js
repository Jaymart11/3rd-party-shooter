// Server-side practice bots: grid pathfinding, line-of-sight perception, human-like reaction and aim.
import { MAP, WEAPONS, rayWorld, modeWeapons, simulateFrag } from './public/js/shared.js';

export const DIFFICULTY = {
  easy:   { reaction: 650, aimError: 0.055, turn: 3.2, head: 0.08, burst: [2, 4], fov: 1.6, strafe: false, stopToShoot: false },
  normal: { reaction: 380, aimError: 0.028, turn: 6.0, head: 0.22, burst: [3, 5], fov: 2.0, strafe: false, stopToShoot: true },
  hard:   { reaction: 210, aimError: 0.013, turn: 10, head: 0.42, burst: [4, 7], fov: 2.4, strafe: true, stopToShoot: true },
};
const NAMES = ['Viper', 'Ghost', 'Rook', 'Saber', 'Echo', 'Nova', 'Talon', 'Brick', 'Flint', 'Kestrel', 'Onyx', 'Jinx'];

const CELL = 0.5;
let GX = 0, GZ = 0;
const RUN = 5.2, WALK = 2.6;

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

export function createBots(ctx) {
  const { players, game, colliders, handleShoot, handleMelee, handleFrag, newId, smokes } = ctx;
  const settings = { count: 0, diff: 'normal' };

  // ---------------------------------------------------------------- navigation grid
  // a cell is walkable when a player-sized circle at ground level touches no box taller than a step
  let walk, gScore, came, stamp, closed;
  const R = 0.38;
  // (re)built whenever the map changes
  function buildNav() {
  GX = Math.round(MAP.half.x * 2 / CELL); GZ = Math.round(MAP.half.z * 2 / CELL);
  walk = new Uint8Array(GX * GZ);
  gScore = new Float32Array(GX * GZ); came = new Int32Array(GX * GZ); stamp = new Uint32Array(GX * GZ); closed = new Uint32Array(GX * GZ);
  for (let gz = 0; gz < GZ; gz++) {
    for (let gx = 0; gx < GX; gx++) {
      const x = -MAP.half.x + (gx + 0.5) * CELL, z = -MAP.half.z + (gz + 0.5) * CELL;
      let ok = Math.abs(x) < MAP.half.x - R && Math.abs(z) < MAP.half.z - R;
      for (const b of colliders) {
        if (!ok) break;
        if (b.max[1] <= 0.5 || b.min[1] >= 1.9) continue;
        if (x > b.min[0] - R && x < b.max[0] + R && z > b.min[2] - R && z < b.max[2] + R) ok = false;
      }
      walk[gz * GX + gx] = ok ? 1 : 0;
    }
  }
  }
  buildNav();
  const cellOf = (x, z) => [Math.floor((x + MAP.half.x) / CELL), Math.floor((z + MAP.half.z) / CELL)];
  const centre = (gx, gz) => [-MAP.half.x + (gx + 0.5) * CELL, -MAP.half.z + (gz + 0.5) * CELL];
  const isWalk = (gx, gz) => gx >= 0 && gz >= 0 && gx < GX && gz < GZ && walk[gz * GX + gx] === 1;

  function nearestWalkable(x, z) {
    const [cx, cz] = cellOf(x, z);
    if (isWalk(cx, cz)) return [cx, cz];
    for (let r = 1; r < 16; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (isWalk(cx + dx, cz + dz)) return [cx + dx, cz + dz];
      }
    }
    return null;
  }

  function lineWalkable(a, b) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(d / 0.25);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const [gx, gz] = cellOf(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      if (!isWalk(gx, gz)) return false;
    }
    return true;
  }

  let search = 0;
  function findPath(from, to) {
    const s = nearestWalkable(from[0], from[1]), e = nearestWalkable(to[0], to[1]);
    if (!s || !e) return null;
    search++;
    const start = s[1] * GX + s[0], goal = e[1] * GX + e[0];
    const heap = [];
    const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    const h = i => { const dx = Math.abs((i % GX) - e[0]), dz = Math.abs(Math.floor(i / GX) - e[1]); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    stamp[start] = search; gScore[start] = 0; came[start] = -1;
    push(h(start), start);
    let found = false, iter = 0;
    while (heap.length && iter++ < 30000) {
      const [, cur] = pop();
      if (cur === goal) { found = true; break; }
      if (closed[cur] === search) continue;
      closed[cur] = search;
      const cx = cur % GX, cz = Math.floor(cur / GX);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (!isWalk(nx, nz)) continue;
        if (dx && dz && (!isWalk(cx + dx, cz) || !isWalk(cx, cz + dz))) continue; // no corner cutting
        const ni = nz * GX + nx;
        const g = gScore[cur] + (dx && dz ? 1.414 : 1);
        if (stamp[ni] !== search || g < gScore[ni]) {
          stamp[ni] = search; gScore[ni] = g; came[ni] = cur;
          push(g + h(ni), ni);
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let i = goal; i !== -1; i = came[i]) cells.push(centre(i % GX, Math.floor(i / GX)));
    cells.reverse();
    // string-pull: skip waypoints we can walk straight past
    const out = [];
    let anchor = [from[0], from[1]];
    for (let i = 0; i < cells.length; i++) {
      const next = cells[i + 1];
      if (next && lineWalkable(anchor, next)) continue;
      out.push(cells[i]);
      anchor = cells[i];
    }
    return out;
  }

  function groundY(x, z) {
    let y = 0;
    for (const b of colliders) {
      if (b.max[1] <= 0.5 && x > b.min[0] - 0.2 && x < b.max[0] + 0.2 && z > b.min[2] - 0.2 && z < b.max[2] + 0.2) y = Math.max(y, b.max[1]);
    }
    return y;
  }

  // ---------------------------------------------------------------- grenade aiming
  // Try a spread of throw angles with the real grenade physics and keep the one that lands closest.
  function solveThrow(bot, target) {
    const W = WEAPONS.grenade, D = DIFFICULTY[settings.diff];
    const o = [bot.pos[0], bot.pos[1] + 1.5, bot.pos[2]];
    const dx = target[0] - o[0], dz = target[2] - o[2], hd = Math.hypot(dx, dz) || 1;
    let best = null;
    for (const sp of [W.lobSpeed, W.throwSpeed]) {
      for (let a = -0.1; a <= 1.15; a += 0.14) {
        const v = [dx / hd * Math.cos(a) * sp, Math.sin(a) * sp, dz / hd * Math.cos(a) * sp];
        const land = simulateFrag(o, v, colliders, W.fuse);
        const err = Math.hypot(land[0] - target[0], (land[1] - target[1]) * 0.5, land[2] - target[2]);
        if (!best || err < best.err) best = { o, v, err };
      }
    }
    if (best) best.v = best.v.map(c => c * (1 + gauss() * D.aimError * 2.5)); // human-ish error
    return best;
  }

  // ---------------------------------------------------------------- perception
  function smokeBlocks(a, b) {
    const now = Date.now();
    for (const s of smokes) {
      if (now < s.from || now > s.until) continue;
      // distance from smoke centre to segment a-b
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [s.c[0] - a[0], s.c[1] - a[1], s.c[2] - a[2]];
      const L = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
      const t = Math.max(0, Math.min(1, (ac[0] * ab[0] + ac[1] * ab[1] + ac[2] * ab[2]) / L));
      const d = Math.hypot(ac[0] - ab[0] * t, ac[1] - ab[1] * t, ac[2] - ab[2] * t);
      if (d < s.r * 0.85) return true;
    }
    return false;
  }

  function canSee(bot, q) {
    const eye = [bot.pos[0], bot.pos[1] + 1.5, bot.pos[2]];
    for (const h of [1.25, 1.6, 0.6]) {
      const tgt = [q.pos[0], q.pos[1] + h * (q.crouch ? 0.72 : 1), q.pos[2]];
      const d = [tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]];
      const len = Math.hypot(d[0], d[1], d[2]);
      d[0] /= len; d[1] /= len; d[2] /= len;
      if (rayWorld(eye, d, len, colliders).t >= len - 0.05 && !smokeBlocks(eye, tgt)) return h;
    }
    return 0;
  }

  // ---------------------------------------------------------------- bot lifecycle
  function makeBot(team) {
    const used = new Set([...players.values()].filter(p => p.bot).map(p => p.name));
    const base = NAMES.find(n => !used.has(`BOT ${n}`)) || `${NAMES[0]}${Math.floor(Math.random() * 99)}`;
    const bot = {
      id: newId(), ws: null, bot: true, name: `BOT ${base}`, team,
      pos: [0, 0, 0], ry: 0, pitch: 0, crouch: false, anim: 0, w: 'rifle', hp: 100, alive: false,
      kills: 0, deaths: 0, smokes: 0, aim: false, brain: {},
    };
    players.set(bot.id, bot);
    return bot;
  }

  // weapon this bot uses in the current mode (some bots prefer the sniper when it's allowed)
  function botWeapon(bot) {
    const list = modeWeapons(game.mode).filter(w => w !== 'pistol');
    const guns = list.filter(w => w !== 'knife');
    if (!guns.length) return 'knife';
    if (guns.includes('sniper') && guns.includes('rifle')) return bot.brain.likesSniper ? 'sniper' : 'rifle';
    return guns[0];
  }

  function reset(bot) {
    const b = bot.brain;
    if (b.likesSniper === undefined) b.likesSniper = Math.random() < 0.25;
    bot.w = botWeapon(bot);
    Object.assign(b, {
      path: null, pi: 0, goal: null, goalKey: '', repathAt: 0, target: null, seenAt: 0, reactAt: 0, lastKnown: null,
      mag: WEAPONS[bot.w].mag, reloadUntil: 0, nextShot: 0, burst: 0, aimHead: false, holdUntil: 0, watchYaw: bot.ry,
      alertPos: null, alertUntil: 0, strafe: 1, strafeUntil: 0, stuckCheck: Date.now(), stuckPos: [...bot.pos], errX: 0, errY: 0,
      site: Math.random() < 0.5 ? 'A' : 'B', spot: null, crouchFight: false,
    });
  }

  function teamSizes() {
    const n = { atk: 0, def: 0 };
    for (const p of players.values()) n[p.team]++;
    return n;
  }

  function removeAll() {
    const ids = [];
    for (const p of players.values()) if (p.bot) ids.push(p.id);
    for (const id of ids) players.delete(id);
    return ids;
  }

  // keep the requested number of bots, filling whichever team is smaller
  function rebalance() {
    const removed = removeAll();
    const added = [];
    const humans = [...players.values()].filter(p => !p.bot).length;
    if (humans > 0) {
      for (let i = 0; i < settings.count; i++) {
        const n = teamSizes();
        const bot = makeBot(n.atk <= n.def ? 'atk' : 'def');
        reset(bot);
        added.push(bot);
      }
    }
    return { removed, added };
  }

  // ---------------------------------------------------------------- brain
  function objective(bot, now) {
    const b = bot.brain;
    const enemies = [...players.values()].filter(q => q.alive && q.team !== bot.team);
    const nearestEnemy = () => enemies.sort((a, c) => Math.hypot(a.pos[0] - bot.pos[0], a.pos[2] - bot.pos[2]) - Math.hypot(c.pos[0] - bot.pos[0], c.pos[2] - bot.pos[2]))[0];
    if (game.phase === 'warmup') {
      // practice: go find the nearest enemy, with a little wander
      const e = nearestEnemy();
      if (e) return { key: `hunt${e.id}${Math.floor(now / 3000)}`, p: [e.pos[0] + rand(-3, 3), e.pos[2] + rand(-3, 3)] };
      if (!b.roam || now > b.holdUntil) { b.roam = pick(MAP.roam); b.holdUntil = now + 8000; }
      return { key: `roam${b.roam}`, p: b.roam };
    }
    const liveFor = 100 - game.timer;
    if (liveFor > 40) {
      const e = nearestEnemy();
      if (e) return { key: `late${e.id}${Math.floor(now / 4000)}`, p: [e.pos[0] + rand(-4, 4), e.pos[2] + rand(-4, 4)] };
    }
    if (bot.team === 'atk') {
      const s = MAP.sites[b.site];
      if (!b.spot) b.spot = [s[0] + rand(-4, 4), s[1] + rand(-3, 3)];
      return { key: `site${b.site}`, p: b.spot, watch: Math.atan2(-(40 - s[0]), -(0 - s[1])) };
    }
    if (!b.spot) b.spot = pick(MAP.defend[b.site]);
    // defenders watch toward where attackers come from
    return { key: `def${b.spot}`, p: b.spot, watch: Math.atan2(-(-10 - b.spot[0]), -(0 - b.spot[1])) };
  }

  function step(bot, dt, now) {
    const b = bot.brain, D = DIFFICULTY[settings.diff];
    const frozen = game.phase === 'prep' || game.phase === 'end' || game.phase === 'matchover';

    // ---- perception
    let best = null, bestD = 1e9, bestH = 0;
    for (const q of players.values()) {
      if (!q.alive || q.team === bot.team) continue;
      const dx = q.pos[0] - bot.pos[0], dz = q.pos[2] - bot.pos[2];
      const d = Math.hypot(dx, dz);
      if (d > 75) continue;
      const ang = Math.abs(wrap(Math.atan2(-dx, -dz) - bot.ry));
      const aware = b.target === q.id || d < 5 || (b.alertUntil > now && b.alertId === q.id);
      if (ang > D.fov / 2 && !aware) continue;
      const h = canSee(bot, q);
      if (h && d < bestD) { best = q; bestD = d; bestH = h; }
    }

    if (best) {
      if (b.target !== best.id || now - b.seenAt > 1200) {
        b.reactAt = now + D.reaction * rand(0.8, 1.35);
        b.errX = gauss() * D.aimError * 3; b.errY = gauss() * D.aimError * 3; // first-sight misaim that settles
        b.crouchFight = settings.diff === 'hard' && Math.random() < 0.3;
      }
      b.target = best.id; b.seenAt = now; b.lastKnown = [best.pos[0], best.pos[2]];
    } else if (b.target && now - b.seenAt > 400) {
      b.target = null;
    }
    const tgt = b.target ? players.get(b.target) : null;
    const engaging = !!(tgt && tgt.alive && now - b.seenAt < 400);

    // ---- facing
    let wantYaw = bot.ry, wantPitch = 0;
    if (engaging) {
      const aimH = b.aimHead ? 1.62 : 1.2;
      const ty = tgt.pos[1] + aimH * (tgt.crouch ? 0.72 : 1);
      const dx = tgt.pos[0] - bot.pos[0], dz = tgt.pos[2] - bot.pos[2], dy = ty - (bot.pos[1] + 1.5);
      wantYaw = Math.atan2(-dx, -dz);
      wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
    } else if (b.alertUntil > now && b.alertPos) {
      wantYaw = Math.atan2(-(b.alertPos[0] - bot.pos[0]), -(b.alertPos[1] - bot.pos[2]));
    }

    // ---- movement goal
    let goal = null, key = '', moveSpeed = RUN;
    if (!engaging) {
      if (b.lastKnown && now - b.seenAt < 7000) { goal = b.lastKnown; key = `lk${Math.round(goal[0])},${Math.round(goal[1])}`; moveSpeed = WALK + 1; }
      else if (b.alertUntil > now && b.alertPos) { goal = b.alertPos; key = `al${Math.round(goal[0])},${Math.round(goal[1])}`; }
      else { const o = objective(bot, now); goal = o.p; key = o.key; if (o.watch !== undefined) b.watchYaw = o.watch; }
    } else if (bot.w === 'knife') {
      goal = [tgt.pos[0], tgt.pos[2]]; key = `stab${tgt.id}${Math.floor(now / 500)}`; moveSpeed = RUN * 1.15;
    } else if (bot.w === 'grenade') {
      if (bestD > 20) { goal = [tgt.pos[0], tgt.pos[2]]; key = `adv${tgt.id}${Math.floor(now / 2000)}`; moveSpeed = RUN; }
    } else if (bestD > 28) {
      // long-range fight: keep pushing in while shooting instead of spraying from afar
      goal = [tgt.pos[0], tgt.pos[2]]; key = `adv${tgt.id}${Math.floor(now / 2000)}`; moveSpeed = WALK;
    }

    let mvx = 0, mvz = 0;
    if (!frozen) {
      if (goal) {
        if (key !== b.goalKey || now > b.repathAt) {
          b.path = findPath([bot.pos[0], bot.pos[2]], goal);
          b.pi = 0; b.goalKey = key; b.repathAt = now + 2500;
        }
        if (b.path && b.pi < b.path.length) {
          const wp = b.path[b.pi];
          const dx = wp[0] - bot.pos[0], dz = wp[1] - bot.pos[2], d = Math.hypot(dx, dz);
          if (d < 0.35) b.pi++;
          else { mvx = dx / d; mvz = dz / d; }
          if (!engaging && !(b.alertUntil > now)) wantYaw = Math.atan2(-dx, -dz);
        } else {
          // arrived: hold and scan the watch direction
          wantYaw = (b.watchYaw ?? bot.ry) + Math.sin(now / 1400 + bot.id) * 0.5;
          if (b.lastKnown && now - b.seenAt >= 7000) b.lastKnown = null;
        }
      } else if (engaging) {
        // fight movement: stop to shoot, strafe on hard
        if (D.strafe) {
          if (now > b.strafeUntil) { b.strafe = Math.random() < 0.5 ? -1 : 1; b.strafeUntil = now + rand(350, 900); }
          const rx = Math.cos(bot.ry), rz = -Math.sin(bot.ry);
          const nx = bot.pos[0] + rx * b.strafe * 0.6, nz = bot.pos[2] + rz * b.strafe * 0.6;
          const [cx, cz] = cellOf(nx, nz);
          if (isWalk(cx, cz)) { mvx = rx * b.strafe * 0.5; mvz = rz * b.strafe * 0.5; }
          else b.strafe *= -1;
        } else if (!D.stopToShoot && b.path && b.pi < b.path.length) {
          const wp = b.path[b.pi], dx = wp[0] - bot.pos[0], dz = wp[1] - bot.pos[2], d = Math.hypot(dx, dz) || 1;
          mvx = dx / d * 0.5; mvz = dz / d * 0.5;
        }
      }
    }

    // turn with limited speed
    const turn = (engaging ? D.turn : 5) * dt;
    bot.ry += Math.max(-turn, Math.min(turn, wrap(wantYaw - bot.ry)));
    bot.ry = wrap(bot.ry);
    bot.pitch += (wantPitch - bot.pitch) * Math.min(1, dt * 8);

    // move along the grid, never into a blocked cell
    const sp = (engaging && bot.w !== 'knife' ? WALK : moveSpeed) * (bot.w === 'sniper' && engaging ? 0.7 : 1) * dt;
    if (mvx || mvz) {
      const nx = bot.pos[0] + mvx * sp, nz = bot.pos[2] + mvz * sp;
      if (isWalk(...cellOf(nx, nz))) { bot.pos[0] = nx; bot.pos[2] = nz; }
      else if (isWalk(...cellOf(nx, bot.pos[2]))) bot.pos[0] = nx;
      else if (isWalk(...cellOf(bot.pos[0], nz))) bot.pos[2] = nz;
    }
    bot.pos[1] = groundY(bot.pos[0], bot.pos[2]);
    bot.crouch = engaging && b.crouchFight;
    bot.aim = engaging;

    // unstick
    if (now - b.stuckCheck > 2000) {
      if (goal && b.path && b.pi < b.path.length && Math.hypot(bot.pos[0] - b.stuckPos[0], bot.pos[2] - b.stuckPos[2]) < 0.4) b.repathAt = 0;
      b.stuckCheck = now; b.stuckPos = [...bot.pos];
    }

    // ---- attacking
    const W = WEAPONS[bot.w];
    if (b.reloadUntil && now >= b.reloadUntil) { b.reloadUntil = 0; b.mag = W.mag; }
    // grenades: lob at where an enemy was last seen, even without line of sight
    if (W.throwable && !engaging && !frozen && b.lastKnown && now - b.seenAt < 4000 && now >= b.nextShot) {
      const tgtP = [b.lastKnown[0], groundY(b.lastKnown[0], b.lastKnown[1]), b.lastKnown[1]];
      const dist = Math.hypot(tgtP[0] - bot.pos[0], tgtP[2] - bot.pos[2]);
      if (dist > 4 && dist < 28) {
        const sol = solveThrow(bot, tgtP);
        if (sol && sol.err < 3) handleFrag(bot, { o: sol.o, v: sol.v });
        b.nextShot = now + rand(1400, 2400);
      }
      return;
    }
    if (!engaging || frozen || b.reloadUntil || now < b.reactAt || now < b.nextShot) return;
    const aimOff = Math.abs(wrap(wantYaw - bot.ry));
    if (W.throwable) {
      if (bestD < 3.5 || bestD > 30) return;  // too close to throw safely, or out of range
      const sol = solveThrow(bot, [tgt.pos[0], tgt.pos[1], tgt.pos[2]]);
      if (sol && sol.err < 2.5) { handleFrag(bot, { o: sol.o, v: sol.v }); b.nextShot = now + rand(1000, 1700); }
      else b.nextShot = now + 400;
      return;
    }
    if (W.melee) {
      if (bestD < 2.1 && aimOff < 0.5) {
        const heavy = Math.random() < 0.4;
        handleMelee(bot, { heavy, ry: bot.ry });
        b.nextShot = now + (heavy ? W.heavyInterval : W.fireInterval) * 1000 + rand(0, 150);
      }
      return;
    }
    const sniper = bot.w === 'sniper';
    if (aimOff > (sniper ? 0.04 : 0.12)) return;
    // snipers take a moment to scope in before the first shot
    if (sniper && now < b.reactAt + 350) return;
    if (b.burst <= 0) { b.burst = sniper ? 1 : Math.round(rand(D.burst[0], D.burst[1])); b.aimHead = Math.random() < D.head; }
    // settle first-sight error over time
    b.errX *= 0.6; b.errY *= 0.6;
    // aim gets shakier with distance, like a human at long range
    const range = (0.7 + bestD / 30) * (sniper ? 0.6 : 1);
    const yaw = bot.ry + b.errX + gauss() * D.aimError * range;
    const pit = bot.pitch + b.errY + gauss() * D.aimError * range;
    const dir = [-Math.sin(yaw) * Math.cos(pit), Math.sin(pit), -Math.cos(yaw) * Math.cos(pit)];
    handleShoot(bot, { w: bot.w, o: [bot.pos[0], bot.pos[1] + 1.5, bot.pos[2]], d: dir });
    b.mag--; b.burst--;
    b.nextShot = now + W.fireInterval * 1000 + (b.burst <= 0 && !sniper ? rand(220, 520) : 0) + (sniper ? rand(100, 400) : 0);
    if (b.mag <= 0) b.reloadUntil = now + W.reload * 1000;
  }

  return {
    settings,
    reset,
    rebuildNav: buildNav,
    rebalance,
    set(count, diff) {
      settings.count = Math.max(0, Math.min(9, count | 0));
      if (DIFFICULTY[diff]) settings.diff = diff;
      return rebalance();
    },
    tick(dt) {
      const now = Date.now();
      for (const p of players.values()) if (p.bot && p.alive) step(p, dt, now);
    },
    // gunfire draws attention from nearby bots
    onShot(shooter, end) {
      const now = Date.now();
      for (const p of players.values()) {
        if (!p.bot || !p.alive || p.team === shooter.team) continue;
        const d = Math.hypot(p.pos[0] - shooter.pos[0], p.pos[2] - shooter.pos[2]);
        const near = end && Math.hypot(p.pos[0] - end[0], p.pos[2] - end[2]) < 3;
        if (d < 35 || near) { p.brain.alertPos = [shooter.pos[0], shooter.pos[2]]; p.brain.alertId = shooter.id; p.brain.alertUntil = now + 3500; }
      }
    },
    onDamaged(bot, attacker) {
      const b = bot.brain;
      b.alertPos = [attacker.pos[0], attacker.pos[2]]; b.alertId = attacker.id; b.alertUntil = Date.now() + 4000;
    },
  };
}
