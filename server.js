// LAN game server: serves the browser client and runs the match over WebSockets.
// Start with:  npm start   (then open http://<this-PC-IP>:3000 on every device on the same Wi-Fi)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { MAP, buildColliders, rayWorld, WEAPONS, TEAMS, simulateNade, SMOKE, MODES, modeWeapons, MAPS, setMap as setActiveMap, simulateFrag } from './public/js/shared.js';
import { createBots, DIFFICULTY } from './bots.js';

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');

// ---------------------------------------------------------------- static files
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.hdr': 'application/octet-stream', '.wasm': 'application/wasm', '.ico': 'image/x-icon',
};

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    // revalidate every time; unchanged files answer 304 so reloads stay fast on Wi-Fi
    const lastMod = st.mtime.toUTCString();
    if (req.headers['if-modified-since'] === lastMod) { res.writeHead(304); res.end(); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Last-Modified': lastMod,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ addresses: lanAddresses(), port: PORT, players: humanCount(), max: MAX_PLAYERS, phase: game.phase, bots: bots.settings, mode: game.mode, map: game.map, rules: game.rules }));
    return;
  }
  let base = PUBLIC, rel = url;
  if (url.startsWith('/three/')) { base = THREE_DIR; rel = url.slice('/three'.length); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base)) { res.writeHead(403); res.end(); return; }
  serveFile(req, res, file);
});

// ---------------------------------------------------------------- game state
const colliders = buildColliders(MAP); // refilled in place when the map changes
const players = new Map(); // id -> player
let nextId = 1;
const smokes = []; // { c:[x,y,z], r, from, until } — bots cannot see through these
const humanCount = () => { let n = 0; for (const p of players.values()) if (!p.bot) n++; return n; };

const ROUND = { prep: 6, live: 100, end: 5, winScore: 7, matchEnd: 9 };
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 10; // humans per room (bots don't count)
const game = {
  phase: 'lobby', timer: 0, round: 0, score: { atk: 0, def: 0 }, message: '', mode: 'standard', map: 'yard',
  hostId: 0,                                   // first player in the room; picks settings and starts the match
  rules: { wallJump: true, dash: true },       // match rules the host can switch off
};
const isHost = p => p && p.id === game.hostId;
function pickHost() {
  if (players.get(game.hostId) && !players.get(game.hostId).bot) return;
  const next = [...players.values()].find(q => !q.bot);
  game.hostId = next ? next.id : 0;
  if (next) broadcast({ t: 'feed', msg: `${next.name} is now the host` });
}

function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(msg, except) {
  const s = JSON.stringify(msg);
  for (const p of players.values()) if (p !== except && p.ws && p.ws.readyState === 1) p.ws.send(s);
}

function teamCount(team, aliveOnly = false) {
  let n = 0;
  for (const p of players.values()) if (p.team === team && (!aliveOnly || p.alive)) n++;
  return n;
}

function pickSpawn(team) {
  const list = MAP.spawns[team];
  // choose the spawn farthest from any living player to avoid stacking
  let best = list[0], bestScore = -1;
  for (const s of list) {
    let minD = 1e9;
    for (const p of players.values()) {
      if (!p.alive) continue;
      const d = Math.hypot(p.pos[0] - s[0], p.pos[2] - s[1]);
      if (d < minD) minD = d;
    }
    const score = minD + Math.random() * 0.5;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

function spawn(p) {
  const s = pickSpawn(p.team);
  p.pos = [s[0], 0, s[1]];
  p.ry = s[2];
  p.hp = 100;
  p.alive = true;
  p.respawnAt = 0;
  p.smokes = 2;
  if (p.bot) bots.reset(p);
  send(p.ws, { t: 'spawn', p: p.pos, ry: p.ry, hp: p.hp, smokes: p.smokes });
}

function roster() {
  return [...players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, k: p.kills, d: p.deaths, alive: p.alive, bot: !!p.bot }));
}

function sendState() {
  broadcast({ t: 'state', phase: game.phase, timer: Math.max(0, game.timer), round: game.round, score: game.score, roster: roster(), msg: game.message, mode: game.mode, map: game.map, host: game.hostId, rules: game.rules, bots: bots.settings, max: MAX_PLAYERS });
}

function setPhase(phase, timer, message = '') {
  game.phase = phase; game.timer = timer; game.message = message;
  broadcast({ t: 'phase', phase, timer, round: game.round, score: game.score, msg: message });
  sendState();
}

function startRound() {
  game.round++;
  for (const p of players.values()) spawn(p);
  setPhase('prep', ROUND.prep, `ROUND ${game.round}`);
}

function endRound(winner, reason) {
  game.score[winner]++;
  const name = TEAMS[winner].name.toUpperCase();
  if (game.score[winner] >= ROUND.winScore) {
    setPhase('matchover', ROUND.matchEnd, `${name} WIN THE MATCH`);
  } else {
    setPhase('end', ROUND.end, `${name} WIN — ${reason}`);
  }
}

function canRunRounds() { return teamCount('atk') > 0 && teamCount('def') > 0; }

function tickGame(dt) {
  game.timer -= dt;
  if (humanCount() === 0) { if (game.phase !== 'lobby') { game.phase = 'lobby'; game.round = 0; game.score = { atk: 0, def: 0 }; } return; }
  if (game.phase === 'lobby') return;
  bots.tick(dt);
  if (game.phase === 'warmup') {
    for (const p of players.values()) if (!p.alive && p.respawnAt && Date.now() > p.respawnAt) spawn(p);
    if (canRunRounds()) {
      game.round = 0; game.score = { atk: 0, def: 0 };
      for (const p of players.values()) { p.kills = 0; p.deaths = 0; }
      startRound();
    }
    return;
  }
  if (!canRunRounds()) { setPhase('warmup', 0, 'WARMUP — waiting for both teams'); for (const p of players.values()) if (!p.alive) spawn(p); return; }
  if (game.phase === 'prep' && game.timer <= 0) setPhase('live', ROUND.live);
  else if (game.phase === 'live') {
    if (teamCount('atk', true) === 0) endRound('def', 'attackers eliminated');
    else if (teamCount('def', true) === 0) endRound('atk', 'defenders eliminated');
    else if (game.timer <= 0) endRound('def', 'time ran out');
  } else if (game.phase === 'end' && game.timer <= 0) startRound();
  else if (game.phase === 'matchover' && game.timer <= 0) returnToLobby();
}

// ---------------------------------------------------------------- hit detection
// Ray vs sphere / capsule, returns distance or Infinity.
function raySphere(o, d, c, r) {
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - cc;
  if (h < 0) return Infinity;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : Infinity;
}
function rayCapsule(o, d, a, bpt, r) {
  // sample-free analytic: closest approach between ray and segment, then sphere test there
  const ba = [bpt[0] - a[0], bpt[1] - a[1], bpt[2] - a[2]];
  const oa = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
  const baba = ba[0] ** 2 + ba[1] ** 2 + ba[2] ** 2;
  const bard = ba[0] * d[0] + ba[1] * d[1] + ba[2] * d[2];
  const baoa = ba[0] * oa[0] + ba[1] * oa[1] + ba[2] * oa[2];
  const rdoa = d[0] * oa[0] + d[1] * oa[1] + d[2] * oa[2];
  const oaoa = oa[0] ** 2 + oa[1] ** 2 + oa[2] ** 2;
  const A = baba - bard * bard, B = baba * rdoa - baoa * bard, C = baba * oaoa - baoa * baoa - r * r * baba;
  const h = B * B - A * C;
  if (h >= 0 && A > 1e-9) {
    const t = (-B - Math.sqrt(h)) / A;
    const y = baoa + t * bard;
    if (t >= 0 && y > 0 && y < baba) return t;
    const cap = y <= 0 ? a : bpt;
    return raySphere(o, d, cap, r);
  }
  return Math.min(raySphere(o, d, a, r), raySphere(o, d, bpt, r));
}

function hitboxes(p) {
  const s = p.crouch ? 0.72 : 1;
  const [x, y, z] = p.pos;
  return {
    head: { c: [x, y + 1.63 * s, z], r: 0.15 },
    body: { a: [x, y + 0.95 * s, z], b: [x, y + 1.42 * s, z], r: 0.27 },
    legs: { a: [x, y + 0.12, z], b: [x, y + 0.92 * s, z], r: 0.2 },
  };
}

function handleShoot(p, m) {
  if (!p.alive || game.phase === 'end' || game.phase === 'matchover' || game.phase === 'prep') return;
  const w = WEAPONS[m.w];
  if (!w || w.melee || !modeWeapons(game.mode).includes(m.w)) return;
  const now = Date.now();
  if (now - (p.lastShot || 0) < w.fireInterval * 1000 * 0.8) return;
  p.lastShot = now;
  const o = m.o, d = m.d;
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  d[0] /= len; d[1] /= len; d[2] /= len;
  // origin must be close to the shooter (camera is a few metres behind the player)
  if (Math.hypot(o[0] - p.pos[0], o[1] - p.pos[1] - 1.5, o[2] - p.pos[2]) > 5) return;

  const wall = rayWorld(o, d, w.range, colliders);
  let bestT = wall.t, victim = null, part = null;
  for (const q of players.values()) {
    if (q === p || !q.alive || q.team === p.team) continue;
    const hb = hitboxes(q);
    const th = raySphere(o, d, hb.head.c, hb.head.r);
    const tb = rayCapsule(o, d, hb.body.a, hb.body.b, hb.body.r);
    const tl = rayCapsule(o, d, hb.legs.a, hb.legs.b, hb.legs.r);
    const t = Math.min(th, tb, tl);
    if (t < bestT) { bestT = t; victim = q; part = t === th ? 'head' : t === tb ? 'body' : 'legs'; }
  }
  const end = [o[0] + d[0] * bestT, o[1] + d[1] * bestT, o[2] + d[2] * bestT];
  broadcast({ t: 'shot', id: p.id, w: m.w, e: end, n: victim ? null : wall.n, hit: !!victim }, p);
  bots.onShot(p, end);
  if (!victim) { send(p.ws, { t: 'impact', e: end, n: wall.n }); return; }

  applyDamage(p, victim, w.damage[part], part, m.w, d, end);
}

function applyDamage(p, victim, dmg, part, weapon, dir, end, from = p.pos) {
  victim.hp -= dmg;
  const kill = victim.hp <= 0;
  if (victim !== p) send(p.ws, { t: 'hit', dmg, part, kill, e: end, victim: victim.id });
  send(victim.ws, { t: 'damaged', hp: Math.max(0, victim.hp), from, dmg });
  if (victim.bot && victim !== p) bots.onDamaged(victim, p);
  if (kill) {
    victim.alive = false; victim.hp = 0; victim.deaths++;
    if (victim !== p) p.kills++; // blowing yourself up is a death, not a kill
    victim.respawnAt = game.phase === 'warmup' ? Date.now() + 3000 : 0;
    broadcast({ t: 'kill', killer: p.id, victim: victim.id, w: weapon, head: part === 'head', back: part === 'back', dir });
    sendState();
  }
}

// Knife: hits the closest enemy in a short cone in front of you, with line of sight.
// Stabbing someone from behind does 1.5x damage.
function handleMelee(p, m) {
  if (!p.alive || game.phase === 'end' || game.phase === 'matchover' || game.phase === 'prep') return;
  if (!modeWeapons(game.mode).includes('knife')) return;
  const w = WEAPONS.knife, now = Date.now(), heavy = !!m.heavy;
  if (now < (p.meleeReady || 0)) return;
  p.meleeReady = now + (heavy ? w.heavyInterval : w.fireInterval) * 1000 * 0.8;
  const yaw = Number.isFinite(m.ry) ? m.ry : p.ry;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  broadcast({ t: 'swing', id: p.id, heavy }, p);
  let best = null, bestD = 1e9;
  for (const q of players.values()) {
    if (q === p || !q.alive || q.team === p.team) continue;
    const dx = q.pos[0] - p.pos[0], dz = q.pos[2] - p.pos[2], dy = q.pos[1] - p.pos[1];
    const d = Math.hypot(dx, dz);
    if (d > w.range + 0.3 || Math.abs(dy) > 1.6) continue;
    if (d > 0.6 && (dx * fx + dz * fz) / d < Math.cos(0.75)) continue;
    const a = [p.pos[0], p.pos[1] + 1.2, p.pos[2]], b = [q.pos[0], q.pos[1] + 1.1, q.pos[2]];
    const dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(...dir) || 1;
    if (rayWorld(a, dir.map(v => v / len), len, colliders).t < len - 0.05) continue;
    if (d < bestD) { bestD = d; best = q; }
  }
  if (!best) return;
  const ax = best.pos[0] - p.pos[0], az = best.pos[2] - p.pos[2], al = Math.hypot(ax, az) || 1;
  const back = (-Math.sin(best.ry) * ax + -Math.cos(best.ry) * az) / al > 0.4;
  const dmg = (heavy ? w.damage.heavy : w.damage.light) * (back ? w.backstabMul : 1);
  applyDamage(p, best, dmg, back ? 'back' : 'body', 'knife', [ax / al, 0, az / al], [best.pos[0], best.pos[1] + 1.2, best.pos[2]]);
}

// Frag grenades: the server simulates the flight with the same code the clients use, so the
// explosion happens in the same place for everyone.
let nextGrenade = 1;
function handleFrag(p, m) {
  if (!p.alive || game.phase === 'end' || game.phase === 'matchover' || game.phase === 'prep') return;
  if (!modeWeapons(game.mode).includes('grenade')) return;
  if (!Array.isArray(m.o) || !Array.isArray(m.v)) return;
  const w = WEAPONS.grenade, now = Date.now();
  if (now - (p.lastThrow || 0) < w.fireInterval * 1000 * 0.8) return;
  p.lastThrow = now;
  const o = m.o.map(Number), v = m.v.map(Number);
  if (Math.hypot(o[0] - p.pos[0], o[1] - p.pos[1] - 1.5, o[2] - p.pos[2]) > 3) return;
  if (Math.hypot(...v) > w.throwSpeed + 12) return; // throw speed + running speed + some slack
  const id = nextGrenade++;
  const at = simulateFrag(o, v, colliders, w.fuse);
  broadcast({ t: 'frag', id, by: p.id, o, v });
  setTimeout(() => explode(p, id, at), w.fuse * 1000);
}

function explode(thrower, id, at) {
  const w = WEAPONS.grenade;
  broadcast({ t: 'boom', id, p: at });
  bots.onShot(thrower, at);
  if (game.phase === 'end' || game.phase === 'matchover' || game.phase === 'prep') return;
  const c = [at[0], at[1] + 0.3, at[2]];
  for (const q of players.values()) {
    if (!q.alive) continue;
    if (q !== thrower && q.team === thrower.team) continue; // no team damage, but your own grenade hurts you
    // closest of chest / feet / head to the blast, and walls block it
    let best = Infinity;
    for (const h of [1.1, 0.3, 1.6]) {
      const tgt = [q.pos[0], q.pos[1] + h, q.pos[2]];
      const d = [tgt[0] - c[0], tgt[1] - c[1], tgt[2] - c[2]], len = Math.hypot(...d);
      if (len >= w.radius || len >= best) continue;
      if (len > 0.05 && rayWorld(c, d.map(x => x / len), len, colliders).t < len - 0.05) continue;
      best = len;
    }
    if (best === Infinity) continue;
    const f = 1 - best / w.radius;
    const dmg = Math.max(1, Math.round(w.damage.max * f * (q === thrower ? w.selfMul : 1)));
    // knockback away from the blast, with some lift
    const dx = q.pos[0] - c[0], dz = q.pos[2] - c[2], hl = Math.hypot(dx, dz) || 1;
    const k = w.knock * f;
    send(q.ws, { t: 'knock', v: [dx / hl * k * 0.8, k * 0.75 + 2, dz / hl * k * 0.8] });
    applyDamage(thrower, q, dmg, 'body', 'grenade', [dx / hl, 0, dz / hl], [q.pos[0], q.pos[1] + 1.1, q.pos[2]], at);
  }
}

// ---------------------------------------------------------------- lobby / match flow
function startMatch() {
  if (game.phase !== 'lobby') return;
  game.round = 0; game.score = { atk: 0, def: 0 };
  smokes.length = 0;
  for (const q of players.values()) { q.kills = 0; q.deaths = 0; }
  // both teams filled: straight into round 1; otherwise warmup until someone joins the other side
  if (canRunRounds()) startRound();
  else { for (const q of players.values()) spawn(q); setPhase('warmup', 0, 'MATCH START'); }
  console.log(`match started: ${MAPS[game.map].name}, ${MODES[game.mode].name}`);
}
function returnToLobby() {
  for (const q of players.values()) { q.alive = false; q.respawnAt = 0; }
  smokes.length = 0;
  setPhase('lobby', 0, 'BACK TO LOBBY');
}

// switching map rebuilds collisions + bot navigation and restarts the match
function setMap(id, by) {
  if (!MAPS[id] || id === game.map) return false;
  game.map = id;
  setActiveMap(id);
  colliders.length = 0;
  colliders.push(...buildColliders(MAP));
  smokes.length = 0;
  bots.rebuildNav();
  if (game.phase === 'lobby') { broadcast({ t: 'map', map: id }); sendState(); return true; }
  game.round = 0; game.score = { atk: 0, def: 0 };
  for (const q of players.values()) { q.kills = 0; q.deaths = 0; q.alive = false; }
  broadcast({ t: 'map', map: id });
  broadcast({ t: 'feed', msg: `${by ? by + ' changed the map to ' : 'map: '}${MAPS[id].name}` });
  game.phase = 'warmup'; game.timer = 0;
  for (const q of players.values()) spawn(q);
  setPhase('warmup', 0, MAPS[id].name.toUpperCase());
  console.log(`map -> ${MAPS[id].name}`);
  return true;
}

// switching mode restarts the match so everyone starts with the new loadout
function setMode(mode, by) {
  if (!MODES[mode] || mode === game.mode) return false;
  game.mode = mode;
  if (game.phase === 'lobby') { for (const q of players.values()) q.w = modeWeapons(mode)[0]; broadcast({ t: 'mode', mode }); sendState(); return true; }
  game.round = 0; game.score = { atk: 0, def: 0 };
  for (const q of players.values()) { q.kills = 0; q.deaths = 0; q.w = modeWeapons(mode)[0]; }
  broadcast({ t: 'mode', mode });
  broadcast({ t: 'feed', msg: `${by ? by + ' set ' : ''}mode: ${MODES[mode].name}` });
  game.phase = 'warmup'; game.timer = 0;
  for (const q of players.values()) spawn(q);
  setPhase('warmup', 0, `${MODES[mode].name.toUpperCase()}`);
  return true;
}

// ---------------------------------------------------------------- bots
const bots = createBots({ players, game, colliders, handleShoot, handleMelee, handleFrag, smokes, newId: () => nextId++ });

// apply a bot roster change: tell clients who left, spawn the new ones when allowed
function applyBots({ removed, added }) {
  for (const id of removed) broadcast({ t: 'leave', id });
  for (const b of added) {
    if (game.phase === 'warmup' || game.phase === 'prep') spawn(b);
  }
  sendState();
}

// ---------------------------------------------------------------- sockets
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let p = null;
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join' && !p) {
      if (humanCount() >= MAX_PLAYERS) { send(ws, { t: 'full', max: MAX_PLAYERS }); ws.close(); return; }
      let team = m.team;
      if (team !== 'atk' && team !== 'def') {
        const h = { atk: 0, def: 0 };
        for (const q of players.values()) if (!q.bot) h[q.team]++;
        team = h.atk <= h.def ? 'atk' : 'def';
      }
      p = {
        id: nextId++, ws, name: String(m.name || 'Player').slice(0, 16).replace(/[<>]/g, '') || 'Player', team,
        pos: [0, 0, 0], ry: 0, pitch: 0, crouch: false, anim: 0, w: 'rifle', hp: 100, alive: false,
        kills: 0, deaths: 0, smokes: 2,
      };
      players.set(p.id, p);
      pickHost();
      send(ws, { t: 'welcome', id: p.id, team, phase: game.phase, bots: bots.settings, mode: game.mode, map: game.map, host: game.hostId, rules: game.rules });
      console.log(`+ ${p.name} joined ${TEAMS[team].name} (${humanCount()} online)`);
      // a running match can still be joined; the lobby is only the waiting room before it starts
      if (game.phase === 'warmup' || game.phase === 'prep') spawn(p);
      else if (game.phase !== 'lobby') send(ws, { t: 'spectate', msg: 'Round in progress — you will spawn next round' });
      broadcast({ t: 'feed', msg: `${p.name} joined ${TEAMS[team].name}` });
      applyBots(bots.rebalance());
      return;
    }
    if (!p) return;
    switch (m.t) {
      case 'u': // movement update
        if (!p.alive || !Array.isArray(m.p)) break;
        p.pos = m.p.map(Number); p.ry = +m.ry || 0; p.pitch = +m.pi || 0;
        p.crouch = !!m.c; p.anim = m.a | 0; p.w = modeWeapons(game.mode).includes(m.w) ? m.w : modeWeapons(game.mode)[0]; p.aim = !!m.ad;
        break;
      case 'shoot': handleShoot(p, m); break;
      case 'melee': handleMelee(p, m); break;
      case 'frag': handleFrag(p, m); break;
      case 'mode': if (isHost(p)) setMode(m.mode, p.name); break;
      case 'map': if (isHost(p)) setMap(m.map, p.name); break;
      case 'start': if (isHost(p)) startMatch(); break;
      case 'endmatch': if (isHost(p) && game.phase !== 'lobby') returnToLobby(); break;
      case 'rules': {
        if (!isHost(p)) break;
        if (typeof m.wallJump === 'boolean') game.rules.wallJump = m.wallJump;
        if (typeof m.dash === 'boolean') game.rules.dash = m.dash;
        broadcast({ t: 'rules', rules: game.rules });
        broadcast({ t: 'feed', msg: `Rules: wall jump ${game.rules.wallJump ? 'ON' : 'OFF'}, dash ${game.rules.dash ? 'ON' : 'OFF'}` });
        sendState();
        break;
      }
      case 'reload': broadcast({ t: 'reload', id: p.id }, p); break;
      case 'bots': {
        if (!isHost(p)) break;
        const before = bots.settings.count + bots.settings.diff;
        applyBots(bots.set(m.count, m.diff));
        if (before !== bots.settings.count + bots.settings.diff)
          broadcast({ t: 'feed', msg: `${p.name} set practice bots: ${bots.settings.count} (${bots.settings.diff})` });
        broadcast({ t: 'bots', ...bots.settings });
        break;
      }
      case 'throw': {
        if (!p.alive || p.smokes <= 0 || game.phase === 'end' || game.phase === 'matchover') break;
        if (!Array.isArray(m.o) || !Array.isArray(m.v)) break;
        p.smokes--;
        const land = simulateNade(m.o.map(Number), m.v.map(Number), colliders);
        const popAt = Date.now() + land.t * 1000;
        smokes.push({ c: [land.p[0], Math.max(land.p[1], 0) + SMOKE.lift, land.p[2]], r: SMOKE.radius, from: popAt + 500, until: popAt + SMOKE.life * 1000 - 1500 });
        while (smokes.length && smokes[0].until < Date.now()) smokes.shift();
        broadcast({ t: 'throw', id: p.id, o: m.o, v: m.v });
        if (game.phase === 'warmup') setTimeout(() => { if (players.has(p.id)) { p.smokes = Math.min(2, p.smokes + 1); send(p.ws, { t: 'smokes', n: p.smokes }); } }, 15000);
        break;
      }
      case 'team': {
        const team = m.team === 'atk' || m.team === 'def' ? m.team : null;
        if (!team || team === p.team) break;
        p.team = team;
        if (p.alive) { p.alive = false; p.respawnAt = Date.now() + 1000; }
        broadcast({ t: 'feed', msg: `${p.name} switched to ${TEAMS[team].name}` });
        send(ws, { t: 'welcome', id: p.id, team, phase: game.phase, host: game.hostId, rules: game.rules });
        if (game.phase !== 'warmup' && game.phase !== 'lobby') send(ws, { t: 'spectate', msg: 'You will spawn next round' });
        applyBots(bots.rebalance());
        break;
      }
    }
  });
  ws.on('close', () => {
    if (!p) return;
    players.delete(p.id);
    broadcast({ t: 'leave', id: p.id });
    broadcast({ t: 'feed', msg: `${p.name} left` });
    console.log(`- ${p.name} left (${humanCount()} online)`);
    pickHost();
    applyBots(bots.rebalance());
  });
});

// ---------------------------------------------------------------- loops
let last = Date.now(), stateAcc = 0;
setInterval(() => {
  const now = Date.now(), dt = (now - last) / 1000; last = now;
  tickGame(dt);
  // snapshot of everyone's transform, 20 Hz
  const snap = [];
  for (const p of players.values()) {
    if (!p.alive) continue;
    snap.push([p.id, +p.pos[0].toFixed(3), +p.pos[1].toFixed(3), +p.pos[2].toFixed(3), +p.ry.toFixed(3), +p.pitch.toFixed(3), (p.crouch ? 1 : 0) | (p.aim ? 2 : 0), p.anim, p.w, p.team]);
  }
  broadcast({ t: 'snap', s: snap });
  stateAcc += dt;
  if (stateAcc > 1) { stateAcc = 0; sendState(); }
}, 50);

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  STRIKELINE — LAN third-person shooter');
  console.log(`  This PC:        http://localhost:${PORT}`);
  for (const a of lanAddresses()) console.log(`  Same Wi-Fi:     http://${a}:${PORT}`);
  console.log('\n  If other devices cannot connect, allow Node.js through Windows Firewall (Private networks).\n');
});
