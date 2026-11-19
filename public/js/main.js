import * as THREE from 'three';
import { loadAll } from './assets.js';
import { buildWorld } from './world.js';
import { Character } from './character.js';
import { LocalPlayer } from './player.js';
import { Effects } from './fx.js';
import { Sfx } from './audio.js';
import { MAP, MAPS, setMap, TEAMS, WEAPONS, MODES, rayWorld } from './shared.js';

const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

// ------------------------------------------------------------------ lobby
let chosenTeam = 'auto', gfx = store.get('gfx') || 'high';
$('name').value = store.get('name') || `Agent${Math.floor(Math.random() * 900 + 100)}`;
document.querySelectorAll('[data-team]').forEach(b => b.onclick = () => {
  chosenTeam = b.dataset.team;
  document.querySelectorAll('[data-team]').forEach(x => x.classList.toggle('sel', x === b));
});
document.querySelectorAll('[data-gfx]').forEach(b => {
  b.classList.toggle('sel', b.dataset.gfx === gfx);
  b.onclick = () => { gfx = b.dataset.gfx; store.set('gfx', gfx); location.reload(); };
});
// ------------------------------------------------------------------ waiting room
// Server-wide settings live on the server; the host changes them from the waiting room.
const room = { host: 0, bots: { count: 0, diff: 'normal' }, rules: { wallJump: true, dash: true }, max: 10 };
let mode = 'standard';
const amHost = () => myId && room.host === myId;

function applyMap(id) {
  if (!MAPS[id] || !world || MAP.id === id) return;
  setMap(id);          // swaps the shared MAP object in place
  world.rebuild();     // new geometry + colliders (same array the player/effects use)
  fx.clearAll();
}
function applyMode(m) {
  if (!MODES[m]) return;
  mode = m;
  me?.setMode(m);
}
function applyRules(r) {
  if (!r) return;
  room.rules = { ...r };
  if (me) me.rules = { ...r };
}

// host-only setting buttons send the change to the server; everyone sees the result
document.querySelectorAll('[data-map]').forEach(b => b.onclick = () => amHost() && net.send({ t: 'map', map: b.dataset.map }));
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => amHost() && net.send({ t: 'mode', mode: b.dataset.mode }));
document.querySelectorAll('[data-bots]').forEach(b => b.onclick = () => amHost() && net.send({ t: 'bots', count: +b.dataset.bots, diff: room.bots.diff }));
document.querySelectorAll('[data-diff]').forEach(b => b.onclick = () => amHost() && net.send({ t: 'bots', count: room.bots.count, diff: b.dataset.diff }));
document.querySelectorAll('[data-rule]').forEach(b => b.onclick = () => amHost() && net.send({ t: 'rules', [b.dataset.rule]: b.dataset.val === '1' }));
document.querySelectorAll('[data-jointeam]').forEach(b => b.onclick = () => net.send({ t: 'team', team: b.dataset.jointeam }));
$('start-match').onclick = () => { net.send({ t: 'start' }); enterPlay(); };
$('end-match').onclick = e => { e.stopPropagation(); net.send({ t: 'endmatch' }); };

function renderRoom() {
  const host = amHost();
  const sel = (q, on) => document.querySelectorAll(q).forEach(b => { b.classList.toggle('sel', on(b)); b.disabled = !host; });
  sel('#room [data-map]', b => b.dataset.map === MAP.id);
  sel('#room [data-mode]', b => b.dataset.mode === mode);
  sel('#room [data-bots]', b => +b.dataset.bots === room.bots.count);
  sel('#room [data-diff]', b => b.dataset.diff === room.bots.diff);
  sel('#room [data-rule]', b => (b.dataset.val === '1') === !!room.rules[b.dataset.rule]);
  for (const team of ['atk', 'def']) {
    $(`room-${team}`).innerHTML = roster.filter(p => p.team === team).map(p =>
      `<li class="${p.id === myId ? 'me' : ''}">${p.id === room.host ? '<span class="host" title="host">★</span>' : ''}${esc(p.name)}${p.bot ? ' <small>BOT</small>' : ''}${p.id === myId ? ' <small>(you)</small>' : ''}</li>`).join('') || '<li class="empty">nobody yet</li>';
  }
  document.querySelectorAll('[data-jointeam]').forEach(b => b.disabled = b.dataset.jointeam === myTeam);
  const humans = roster.filter(p => !p.bot).length;
  const hostName = roster.find(p => p.id === room.host)?.name || '';
  $('room-count').textContent = `${humans}/${room.max} players · host: ${hostName}`;
  $('start-match').classList.toggle('hidden', !host);
  $('room-wait').classList.toggle('hidden', host);
  $('end-match').classList.toggle('hidden', !host);
}

// show the waiting room while the server is in the lobby, the HUD while a match runs
let inRoom = false;
function updateScreens() {
  if (!started) return;
  const lobby = phase === 'lobby';
  if (lobby !== inRoom) {
    inRoom = lobby;
    $('room').classList.toggle('hidden', !lobby);
    $('hud').classList.toggle('hidden', lobby);
    if (lobby) {
      document.exitPointerLock?.();
      me && (me.alive = false);
      myChar?.setVisible(false);
      for (const r of remotes.values()) r.char.setVisible(false);
      fx?.clearAll();
    }
  }
  $('paused').classList.toggle('hidden', lobby || pointerLocked || !started);
  if (lobby) renderRoom();
}

fetch('/info').then(r => r.json()).then(info => {
  if (info.map) applyMap(info.map), (pendingMap = info.map);
  if (info.mode) applyMode(info.mode);
  const urls = info.addresses.map(a => `<b>http://${a}:${info.port}</b>`).join('<br>');
  $('lan').innerHTML = `Friends on the same Wi-Fi open:<br>${urls || '<b>(no network found)</b>'}`;
  $('room-lan').innerHTML = `Friends on the same Wi-Fi join at ${urls || '(no network found)'}`;
  const full = info.players >= info.max;
  $('roominfo').innerHTML = full ? `<b>Room is full</b> (${info.players}/${info.max})`
    : info.phase === 'lobby' ? `${info.players}/${info.max} in the waiting room`
    : `Match in progress · ${MAPS[info.map]?.name} · ${MODES[info.mode]?.name} · ${info.players}/${info.max} players`;
  joinLabel = info.phase === 'lobby' ? 'JOIN ROOM' : 'JOIN MATCH';
  if (!$('play').disabled) $('play').textContent = joinLabel;
}).catch(() => {});
let pendingMap = null, joinLabel = 'JOIN';

// ------------------------------------------------------------------ renderer
const canvas = $('game');
// Detect software rendering (GPU acceleration off): it cannot run a 3D shooter, so drop to the
// cheapest settings and tell the player how to fix it.
const gpuName = (() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
  } catch { return ''; }
})();
const softwareGL = /basic render|swiftshader|llvmpipe|software/i.test(gpuName);
if (softwareGL) {
  gfx = 'low';
  const warn = document.createElement('div');
  warn.className = 'gpu-warn';
  warn.innerHTML = '<b>Your browser is not using your graphics card</b>, so the game will be very slow.<br>' +
    'Chrome/Edge: Settings → System → turn on <b>“Use graphics acceleration when available”</b>, then click Relaunch.';
  $('lobby').querySelector('.panel').prepend(warn);
}
const high = gfx === 'high';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: high, powerPreference: 'high-performance' });
// dynamic resolution: start at a sensible pixel ratio and adapt to keep the frame rate up
const res = { max: softwareGL ? 0.5 : Math.min(devicePixelRatio, high ? 1.5 : 1), min: 0.5, cur: 1, lowered: 0, goodSecs: 0 };
res.cur = res.max;
renderer.setPixelRatio(res.cur);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = !softwareGL;
renderer.shadowMap.type = high ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.05, 600);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});

const sfx = new Sfx();
let world, fx, me, myChar;
let myId = 0, myTeam = 'atk', phase = 'warmup', phaseTimer = 0, roster = [];
const remotes = new Map();
const lastHeard = new Map(); // id -> time an enemy last fired (for minimap)
let net = { send() {} };
let started = false;

// ------------------------------------------------------------------ loading
loadAll(p => { $('progress').firstElementChild.style.width = `${Math.round(p * 100)}%`; }).then(() => {
  world = buildWorld(scene, renderer, gfx);
  fx = new Effects(scene, world.colliders);
  me = new LocalPlayer(camera, world.colliders);
  if (pendingMap && pendingMap !== MAP.id) applyMap(pendingMap);
  $('play').disabled = false; $('play').textContent = joinLabel;
  window.__game = { scene, camera, me, remotes, fx, get myChar() { return myChar; }, THREE }; // debug handle
}).catch(err => { console.error(err); $('play').textContent = 'Failed to load assets'; });

$('play').onclick = () => {
  const name = $('name').value.trim() || 'Player';
  store.set('name', name);
  sfx.init();
  connect(name);
  $('lobby').classList.add('hidden');
  started = true;
};

// ------------------------------------------------------------------ network
function connect(name) {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  net = { send: m => ws.readyState === 1 && ws.send(JSON.stringify(m)) };
  ws.onopen = () => net.send({ t: 'join', name, team: chosenTeam });
  ws.onmessage = e => handle(JSON.parse(e.data));
  ws.onclose = () => {
    if (roomFull) return;
    $('room').classList.add('hidden'); $('hud').classList.remove('hidden');
    centerMsg('DISCONNECTED', 'Refresh the page to reconnect', 99999);
  };
}

function remote(id, team) {
  let r = remotes.get(id);
  if (!r) {
    r = { id, char: new Character(scene, team), pos: new THREE.Vector3(), target: new THREE.Vector3(), yaw: 0, tYaw: 0, pitch: 0, tPitch: 0,
      vel: [0, 0], alive: true, flags: 0, w: 'rifle', team, seen: 0, step: 0, plate: null };
    r.first = true;
    remotes.set(id, r);
  }
  return r;
}

function nameOf(id) { if (id === myId) return roster.find(p => p.id === id)?.name || 'You'; return roster.find(p => p.id === id)?.name || '???'; }
function teamOf(id) { if (id === myId) return myTeam; return roster.find(p => p.id === id)?.team || remotes.get(id)?.team; }

function handle(m) {
  switch (m.t) {
    case 'map':
      applyMap(m.map);
      centerMsg(MAPS[m.map].name.toUpperCase(), 'New match', 2500);
      break;
    case 'mode':
      applyMode(m.mode);
      centerMsg(MODES[m.mode].name.toUpperCase(), 'New match', 2500);
      break;
    case 'frag': {
      fx.throwFrag(m.id, m.o, m.v);
      const r = remotes.get(m.by);
      if (r) { r.char.swing(false); sfx.swing(false, r.pos.toArray()); }
      break;
    }
    case 'boom': {
      fx.explode(m.id, m.p);
      sfx.boom(m.p);
      const d = Math.hypot(camera.position.x - m.p[0], camera.position.y - m.p[1], camera.position.z - m.p[2]);
      if (d < 16) shake = Math.max(shake, 0.45 * (1 - d / 16));
      break;
    }
    case 'knock':
      if (me.alive) { me.vel.x += m.v[0]; me.vel.y = Math.max(me.vel.y, 0) + m.v[1]; me.vel.z += m.v[2]; me.grounded = false; me.dashT = 0; }
      break;
    case 'swing': {
      const r = remotes.get(m.id);
      if (r) { r.char.swing(m.heavy); sfx.swing(m.heavy, r.pos.toArray()); }
      break;
    }
    case 'full':
      roomFull = true;
      started = false;
      $('lobby').classList.remove('hidden'); $('room').classList.add('hidden'); $('hud').classList.add('hidden');
      $('roominfo').innerHTML = `<b>Room is full</b> (${m.max}/${m.max}). Try again when someone leaves.`;
      $('play').disabled = true;
      break;
    case 'rules': applyRules(m.rules); updateScreens(); break;
    case 'welcome':
      if (m.map) applyMap(m.map);
      if (m.mode) applyMode(m.mode);
      if (m.host) room.host = m.host;
      applyRules(m.rules);
      myId = m.id; myTeam = m.team; phase = m.phase;
      if (!myChar) myChar = new Character(scene, myTeam);
      else { myChar.setTeam(myTeam); me.alive = false; }
      myChar.setVisible(false);
      $('team-tag').textContent = TEAMS[myTeam].name.toUpperCase();
      $('team-tag').style.color = TEAMS[myTeam].color;
      updateScreens();
      break;
    case 'spawn':
      me.spawn(m.p, m.ry);
      me.smokes = m.smokes;
      myChar.revive(); myChar.setVisible(true);
      me.camPos.set(m.p[0], m.p[1] + 2, m.p[2]);
      spectating = null;
      updateHud(true);
      break;
    case 'spectate':
      me.alive = false; myChar?.setVisible(false);
      centerMsg('SPECTATING', m.msg, 3000);
      break;
    case 'snap': {
      const seen = new Set();
      for (const [id, x, y, z, ry, pi, flags, , w, team] of m.s) {
        if (id === myId) continue;
        seen.add(id);
        const r = remote(id, team);
        if (r.team !== team) { r.team = team; r.char.setTeam(team); }
        if (!r.alive || r.first) { r.alive = true; r.char.revive(); r.pos.set(x, y, z); r.yaw = ry; r.first = false; }
        r.char.setVisible(true);
        r.target.set(x, y, z); r.tYaw = ry; r.tPitch = pi; r.flags = flags; r.w = w;
      }
      for (const [id, r] of remotes) if (!seen.has(id) && r.alive && !r.dying) { r.char.setVisible(false); }
      break;
    }
    case 'shot': {
      const r = remotes.get(m.id);
      const end = new THREE.Vector3().fromArray(m.e);
      let from = end;
      if (r) { from = r.char.muzzleWorld(new THREE.Vector3()); r.char.kick = 1; fx.muzzle(from, end.clone().sub(from).normalize()); }
      fx.tracer(from, end);
      if (m.hit) fx.impact(end, null, 'blood'); else fx.impact(end, m.n);
      sfx.shot(m.w, from.toArray());
      if (r && r.team !== myTeam) lastHeard.set(m.id, performance.now());
      break;
    }
    case 'hit':
      hitmarker(m.part === 'head' || m.part === 'back', m.kill);
      sfx.hit(m.part === 'head' || m.part === 'back', m.kill);
      fx.impact(new THREE.Vector3().fromArray(m.e), null, 'blood');
      break;
    case 'damaged': {
      me.hp = m.hp; sfx.hurt();
      $('vignette').style.transition = 'none'; $('vignette').style.opacity = 0.9;
      requestAnimationFrame(() => { $('vignette').style.transition = 'opacity .6s'; $('vignette').style.opacity = me.hp < 30 ? 0.35 : 0; });
      const ang = Math.atan2(m.from[0] - me.pos.x, m.from[2] - me.pos.z);
      const rel = -(ang - (me.yaw + Math.PI));
      const dd = $('dmgdir');
      dd.style.transition = 'none'; dd.style.opacity = 1; dd.style.transform = `rotate(${rel}rad)`;
      requestAnimationFrame(() => { dd.style.transition = 'opacity .9s'; dd.style.opacity = 0; });
      break;
    }
    case 'kill': {
      addKill(m);
      if (m.victim === myId) {
        me.alive = false; me.hp = 0;
        me.aiming = false; me.firing = false; me.triggerHeld = false; // drop out of the scope
        myChar.die(m.dir);
        spectating = null;
        centerMsg('ELIMINATED', `by ${nameOf(m.killer)}${m.head ? ' (headshot)' : m.back ? ' (backstab)' : ''}`, 2500);
      } else {
        const r = remotes.get(m.victim);
        if (r) { r.alive = false; r.char.die(m.dir); r.char.setVisible(true); }
      }
      break;
    }
    case 'leave': {
      const r = remotes.get(m.id);
      if (r) { r.char.dispose(); r.plate?.remove(); remotes.delete(m.id); }
      break;
    }
    case 'reload': break;
    case 'throw':
      fx.throwSmoke(m.o, m.v, p => sfx.smoke(p.toArray()));
      break;
    case 'smokes': me.smokes = m.n; break;
    case 'phase':
      phase = m.phase; phaseTimer = m.timer;
      if (m.phase === 'prep') { fx.clearRound(); centerMsg(m.msg, 'Get ready', 2500); sfx.beep(660); }
      else if (m.phase === 'live') { centerMsg('GO', '', 900); sfx.beep(990); }
      else if (m.phase === 'end' || m.phase === 'matchover') centerMsg(m.msg.split(' — ')[0], m.msg.split(' — ')[1] || '', 4000);
      else if (m.phase === 'warmup') centerMsg('WARMUP', m.msg.replace('WARMUP — ', ''), 2500);
      $('score-atk').textContent = m.score.atk; $('score-def').textContent = m.score.def;
      if (m.phase === 'lobby') centerMsg('', '', 1);
      updateScreens();
      break;
    case 'state':
      if (m.mode && m.mode !== mode) applyMode(m.mode);
      if (m.map && m.map !== MAP.id) applyMap(m.map);
      phase = m.phase; phaseTimer = m.timer; roster = m.roster;
      $('score-atk').textContent = m.score.atk; $('score-def').textContent = m.score.def;
      if (m.host) room.host = m.host;
      if (m.bots) room.bots = m.bots;
      if (m.max) room.max = m.max;
      applyRules(m.rules);
      renderAlive(); if (scoreboardOpen) renderScoreboard();
      updateScreens();
      break;
    case 'feed': feedMsg(m.msg); break;
    case 'bots': room.bots = { count: m.count, diff: m.diff }; updateScreens(); break;
  }
}

// ------------------------------------------------------------------ HUD helpers
let centerTimeout;
function centerMsg(text, sub = '', ms = 2000) {
  $('center-msg').textContent = text; $('sub-msg').textContent = sub;
  $('center-msg').classList.add('show');
  clearTimeout(centerTimeout);
  centerTimeout = setTimeout(() => { $('center-msg').classList.remove('show'); $('sub-msg').textContent = ''; }, ms);
}
function hitmarker(head, kill) {
  const h = $('hitmarker');
  h.className = 'show' + (head ? ' head' : '') + (kill ? ' kill' : '');
  setTimeout(() => h.classList.remove('show'), 90);
}
function addKill(m) {
  const kt = teamOf(m.killer), vt = teamOf(m.victim);
  const div = document.createElement('div');
  if (m.killer === myId || m.victim === myId) div.className = 'mine';
  div.innerHTML = `<span class="${kt === 'atk' ? 'a' : 'd'}">${esc(nameOf(m.killer))}</span><span class="w">${WEAPONS[m.w]?.name || ''}${m.head ? ' ✛' : m.back ? ' ⟲' : ''}</span><span class="${vt === 'atk' ? 'a' : 'd'}">${esc(nameOf(m.victim))}</span>`;
  $('killfeed').prepend(div);
  setTimeout(() => div.remove(), 6000);
  while ($('killfeed').children.length > 6) $('killfeed').lastChild.remove();
}
function feedMsg(text) {
  const d = document.createElement('div'); d.textContent = text;
  $('feedmsg').append(d); setTimeout(() => d.remove(), 5000);
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function renderAlive() {
  for (const team of ['atk', 'def']) {
    $(`alive-${team}`).innerHTML = roster.filter(p => p.team === team).map(p => `<i class="${p.alive ? '' : 'dead'}"></i>`).join('');
  }
}
let scoreboardOpen = false;
function renderScoreboard() {
  const col = team => `<div class="${team}"><h3>${TEAMS[team].name.toUpperCase()}</h3><table><tr><th>PLAYER</th><th>K</th><th>D</th></tr>${
    roster.filter(p => p.team === team).sort((a, b) => b.k - a.k).map(p => `<tr class="${p.id === myId ? 'me' : ''} ${p.alive ? '' : 'dead'}"><td>${esc(p.name)}${p.bot ? ' <small style="opacity:.6">BOT</small>' : ''}</td><td>${p.k}</td><td>${p.d}</td></tr>`).join('')}</table></div>`;
  $('scoreboard').innerHTML = col('atk') + col('def');
}

function updateHud() {
  if (!me) return;
  $('hp').textContent = Math.max(0, Math.round(me.hp));
  $('hp-fill').style.width = `${Math.max(0, me.hp)}%`;
  $('hp-fill').style.background = me.hp < 30 ? '#ff4655' : '#e9f5ef';
  const a = me.ammo[me.weapon];
  if (WEAPONS[me.weapon].melee || WEAPONS[me.weapon].throwable) { $('mag').textContent = '∞'; $('reserve').textContent = ''; }
  else { $('mag').textContent = a.mag; $('reserve').textContent = `/ ${a.res}`; }
  $('wname').textContent = WEAPONS[me.weapon].name;
  $('smokes').textContent = me.smokes ?? 0;
  const rb = $('reload-bar');
  rb.classList.toggle('on', me.reloading > 0);
  if (me.reloading > 0) rb.firstElementChild.style.width = `${(1 - me.reloading / me.reloadTotal) * 100}%`;
  const t = Math.max(0, Math.ceil(phaseTimer));
  $('timer').textContent = phase === 'warmup' ? '—' : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  $('phase').textContent = `${{ warmup: 'WARMUP', prep: 'PREP', live: 'LIVE', end: 'ROUND OVER', matchover: 'MATCH OVER' }[phase] || phase} · ${MODES[mode].name.toUpperCase()}`;
  const gap = 3 + me.spread * 700;
  $('crosshair').style.setProperty('--gap', `${Math.min(40, gap)}px`);
  $('crosshair').style.opacity = me.alive && !me.scoped ? 1 : 0;
}

// minimap
const mm = $('mm').getContext('2d');
function drawMinimap() {
  const W = 200, H = 120, sx = W / (MAP.half.x * 2), sz = H / (MAP.half.z * 2);
  const X = x => (x + MAP.half.x) * sx, Z = z => (z + MAP.half.z) * sz;
  mm.clearRect(0, 0, W, H);
  mm.fillStyle = 'rgba(40,46,52,0.8)'; mm.fillRect(0, 0, W, H);
  mm.fillStyle = 'rgba(210,205,195,0.85)';
  for (const [cx, y, cz, w, h, d] of MAP.boxes) { if (y > 0.5 && h < 0.5) continue; mm.fillRect(X(cx - w / 2), Z(cz - d / 2), Math.max(1, w * sx), Math.max(1, d * sz)); }
  mm.fillStyle = 'rgba(255,210,60,0.8)'; mm.font = 'bold 10px sans-serif';
  mm.fillText('A', X(26), Z(22)); mm.fillText('B', X(26), Z(-20));
  const now = performance.now();
  for (const r of remotes.values()) {
    if (!r.alive || !r.char.root.visible) continue;
    const ally = r.team === myTeam;
    if (!ally && now - (lastHeard.get(r.id) || -1e9) > 1500) continue;
    mm.fillStyle = TEAMS[r.team].color;
    mm.beginPath(); mm.arc(X(r.pos.x), Z(r.pos.z), 3, 0, Math.PI * 2); mm.fill();
  }
  if (me?.alive) {
    mm.save(); mm.translate(X(me.pos.x), Z(me.pos.z)); mm.rotate(-me.yaw);
    mm.fillStyle = '#ffd23c'; mm.beginPath(); mm.moveTo(0, -6); mm.lineTo(4, 4); mm.lineTo(-4, 4); mm.closePath(); mm.fill();
    mm.restore();
  }
}

// ------------------------------------------------------------------ input
let pointerLocked = false, roomFull = false;
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  $('paused').classList.toggle('hidden', pointerLocked || !started || phase === 'lobby');
  if (!pointerLocked && me) { me.firing = false; me.aiming = false; me.keys.clear(); }
});
function enterPlay() { canvas.requestPointerLock?.(); }
$('paused').onclick = () => enterPlay();
canvas.addEventListener('click', () => { if (started && !pointerLocked && phase !== 'lobby') enterPlay(); });
const SENS = 0.0022;
document.addEventListener('mousemove', e => {
  if (!pointerLocked || !me) return;
  const s = SENS * (me.scoped ? me.weaponDef.scopeFov / 74 : me.adsActive ? 0.6 : 1);
  me.yaw -= e.movementX * s;
  me.pitch = THREE.MathUtils.clamp(me.pitch - e.movementY * s, -1.25, 1.25);
});
document.addEventListener('mousedown', e => {
  if (!pointerLocked) return;
  if (e.button === 0) { me.firing = true; if (!me.alive) cycleSpectate(); }
  if (e.button === 2) me.aiming = true;
});
document.addEventListener('mouseup', e => {
  if (e.button === 0) { me.firing = false; me.triggerHeld = false; }
  if (e.button === 2) me.aiming = false;
});
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('keydown', e => {
  if (!started) return;
  if (e.code === 'Tab') { e.preventDefault(); scoreboardOpen = true; renderScoreboard(); $('scoreboard').classList.remove('hidden'); return; }
  if (!pointerLocked) return;
  // while playing, game keys never reach the browser (stops Ctrl+D bookmark, Ctrl+S save, etc.)
  if (!/^F\d+$/.test(e.code) && e.code !== 'Escape') e.preventDefault();
  me.keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'KeyR' && me.alive) me.startReload(sfx, net);
  if (e.code === 'KeyQ' && me.dash()) sfx.dash();
  if (e.code === 'Space') me.jumpQueued = true;
  const slot = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
  if (slot >= 0 && me.loadout[slot]) me.switchWeapon(me.loadout[slot]);
  if (e.code === 'KeyN') {
    const ids = Object.keys(MAPS);
    net.send({ t: 'map', map: ids[(ids.indexOf(MAP.id) + 1) % ids.length] });
  }
  if (e.code === 'KeyM') {
    const keys = Object.keys(MODES);
    net.send({ t: 'mode', mode: keys[(keys.indexOf(mode) + 1) % keys.length] });
  }
  if (e.code === 'KeyV') me.shoulder *= -1;
  if (e.code === 'KeyE') throwSmoke();
  if (e.code === 'KeyT') net.send({ t: 'team', team: myTeam === 'atk' ? 'def' : 'atk' });
  if (e.code === 'KeyB') {
    const steps = [0, 1, 3, 5];
    const next = steps[(steps.indexOf(room.bots.count) + 1) % steps.length] ?? 0;
    net.send({ t: 'bots', count: next, diff: room.bots.diff });
  }
});
document.addEventListener('keyup', e => {
  if (e.code === 'Tab') { scoreboardOpen = false; $('scoreboard').classList.add('hidden'); }
  me?.keys.delete(e.code);
});
addEventListener('wheel', e => {
  if (!pointerLocked || !me) return;
  const l = me.loadout, i = l.indexOf(me.weapon);
  me.switchWeapon(l[(i + (e.deltaY > 0 ? 1 : -1) + l.length) % l.length]);
});

function throwSmoke() {
  if (!me.alive || !(me.smokes > 0) || phase === 'end' || phase === 'matchover') return;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const o = new THREE.Vector3(me.pos.x, me.pos.y + 1.6, me.pos.z).addScaledVector(fwd, 0.5);
  // make sure the throw does not start inside a wall
  const h = rayWorld([me.pos.x, me.pos.y + 1.6, me.pos.z], fwd.toArray(), 0.6, world.colliders);
  if (h.t < 0.6) o.set(me.pos.x, me.pos.y + 1.6, me.pos.z);
  const v = fwd.multiplyScalar(17).add(new THREE.Vector3(0, 3.5, 0)).add(new THREE.Vector3(me.vel.x, 0, me.vel.z).multiplyScalar(0.5));
  net.send({ t: 'throw', o: o.toArray().map(n => +n.toFixed(3)), v: v.toArray().map(n => +n.toFixed(3)) });
  me.smokes--;
}

// spectator camera when dead
let spectating = null;
function cycleSpectate() {
  const mates = [...remotes.values()].filter(r => r.alive && r.team === myTeam && r.char.root.visible);
  if (!mates.length) { spectating = null; return; }
  const i = mates.indexOf(spectating);
  spectating = mates[(i + 1) % mates.length];
}

// ------------------------------------------------------------------ main loop
const clock = new THREE.Clock();
let sendAcc = 0, hudAcc = 0, lobbyT = 0, smokeFog = 0, wasScoped = false, shake = 0;
const tmpV = new THREE.Vector3();

// ---- performance meter (F3)
const perf = { frames: 0, t0: performance.now(), cpu: 0, gpu: 0, worst: 0, fps: 0, cpuMs: 0, renderMs: 0, worstMs: 0, calls: 0, tris: 0, show: false };
window.__perf = perf;
const perfEl = document.createElement('div');
perfEl.style.cssText = 'position:fixed;left:230px;top:18px;z-index:20;font:12px/1.4 monospace;color:#9f9;background:rgba(0,0,0,.6);padding:4px 8px;pointer-events:none;display:none;white-space:pre';
document.body.append(perfEl);
addEventListener('keydown', e => { if (e.code === 'F3') { e.preventDefault(); perf.show = !perf.show; perfEl.style.display = perf.show ? 'block' : 'none'; } });
let lastFrameAt = performance.now();
function perfTick(tStart, tRender, tEnd) {
  perf.frames++; perf.cpu += tRender - tStart; perf.gpu += tEnd - tRender;
  perf.worst = Math.max(perf.worst, tEnd - lastFrameAt); lastFrameAt = tEnd;
  if (tEnd - perf.t0 >= 1000) {
    const n = perf.frames;
    Object.assign(perf, { fps: Math.round(n * 1000 / (tEnd - perf.t0)), cpuMs: +(perf.cpu / n).toFixed(2), renderMs: +(perf.gpu / n).toFixed(2), worstMs: Math.round(perf.worst),
      calls: renderer.info.render.calls, tris: renderer.info.render.triangles, frames: 0, t0: tEnd, cpu: 0, gpu: 0, worst: 0 });
    adaptResolution(perf.fps);
    const c = renderer.domElement;
    perfEl.textContent = `${perf.fps} fps  worst ${perf.worstMs}ms
logic ${perf.cpuMs}ms  render ${perf.renderMs}ms
draws ${perf.calls}  tris ${(perf.tris / 1000).toFixed(0)}k
${c.width}x${c.height} x${res.cur} ${gfx}${softwareGL ? ' SOFTWARE GL' : ''}`;
  }
}

// lower the render resolution when the frame rate drops, raise it again when there is headroom
function adaptResolution(fps) {
  if (!started || document.hidden) return;
  const now = performance.now();
  if (fps < 50 && res.cur > res.min) {
    res.cur = Math.max(res.min, +(res.cur - 0.15).toFixed(2)); res.lowered = now; res.goodSecs = 0;
    renderer.setPixelRatio(res.cur); renderer.setSize(innerWidth, innerHeight);
  } else if (fps >= 58 && res.cur < res.max && now - res.lowered > 10000) {
    if (++res.goodSecs >= 3) {
      res.cur = Math.min(res.max, +(res.cur + 0.1).toFixed(2)); res.goodSecs = 0;
      renderer.setPixelRatio(res.cur); renderer.setSize(innerWidth, innerHeight);
    }
  } else res.goodSecs = 0;
}

function frame() {
  requestAnimationFrame(frame);
  const tStart = performance.now();
  const dt = Math.min(0.05, clock.getDelta());
  if (!world) return;

  if (!started || !myChar || phase === 'lobby') {
    // lobby fly-over
    lobbyT += dt * 0.06;
    camera.position.set(Math.cos(lobbyT) * MAP.half.x * 0.8, 22, Math.sin(lobbyT) * MAP.half.z * 0.85);
    camera.lookAt(0, 0, 0);
    fx.update(dt);
    renderer.render(scene, camera);
    return;
  }

  phaseTimer -= dt;
  me.frozen = phase === 'prep' || phase === 'matchover';

  if (me.alive) {
    me.physics(dt, { onStep: () => sfx.footstep([me.pos.x, me.pos.y, me.pos.z], 0.35), onWallJump: () => sfx.footstep(null, 0.9), onPad: () => sfx.pad() });
    me.updateCamera(dt);
    if (shake > 0) { // explosion camera shake
      camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake;
      shake = Math.max(0, shake - dt * 1.4);
    }
    const shot = me.tryFire(dt, sfx, net);
    if (shot && shot.melee) {
      net.send({ t: 'melee', heavy: shot.heavy, ry: +me.yaw.toFixed(3) });
      myChar.swing(shot.heavy);
      sfx.swing(shot.heavy, null);
    } else if (shot && shot.throw) {
      // throw from just in front of the face, along the crosshair, plus some of our running speed
      const W = WEAPONS.grenade;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const head = [me.pos.x, me.pos.y + 1.6, me.pos.z];
      const o = new THREE.Vector3(...head).addScaledVector(fwd, 0.45);
      if (rayWorld(head, fwd.toArray(), 0.6, world.colliders).t < 0.6) o.set(...head);
      const v = fwd.multiplyScalar(shot.lob ? W.lobSpeed : W.throwSpeed).add(new THREE.Vector3(0, shot.lob ? 2 : 3, 0))
        .add(new THREE.Vector3(me.vel.x, 0, me.vel.z).multiplyScalar(0.5));
      net.send({ t: 'frag', o: o.toArray().map(n => +n.toFixed(3)), v: v.toArray().map(n => +n.toFixed(3)) });
      myChar.swing(false);
      sfx.swing(false, null);
    } else if (shot) {
      net.send({ t: 'shoot', w: me.weapon, o: shot.o.toArray().map(n => +n.toFixed(3)), d: shot.d.toArray().map(n => +n.toFixed(4)) });
      // instant local feedback
      const hit = rayWorld(shot.o.toArray(), shot.d.toArray(), WEAPONS[me.weapon].range, world.colliders);
      const end = shot.o.clone().addScaledVector(shot.d, hit.t);
      const muzzle = myChar.muzzleWorld(new THREE.Vector3());
      fx.muzzle(muzzle, shot.d);
      fx.tracer(muzzle, end);
      if (hit.n && !hitsRemoteFirst(shot, hit.t)) fx.impact(end, hit.n);
      sfx.shot(me.weapon, null);
      myChar.kick = 1;
    }
  } else {
    // dead / spectating: always use the normal field of view (you may have died while scoped)
    if (camera.fov !== 74) { camera.fov = me.fov = 74; camera.updateProjectionMatrix(); }
    if (spectating && (!spectating.alive || !remotes.has(spectating.id))) spectating = null;
    if (!spectating) cycleSpectate();
    if (spectating) {
      const r = spectating;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r.pitch * 0.6, r.yaw, 0, 'YXZ'));
      const off = new THREE.Vector3(0.6, 0.4, 2.8).applyQuaternion(q);
      tmpV.set(r.pos.x, r.pos.y + 1.55, r.pos.z);
      const dir = off.clone().normalize();
      const hit = rayWorld(tmpV.toArray(), dir.toArray(), off.length(), world.colliders);
      camera.position.copy(tmpV).addScaledVector(dir, Math.max(0.3, hit.t - 0.2));
      camera.quaternion.copy(q);
    } else {
      // orbit our own body
      tmpV.set(me.pos.x, me.pos.y + 0.5, me.pos.z);
      me.yaw += dt * 0.25;
      const off = new THREE.Vector3(Math.sin(me.yaw) * 4, 3, Math.cos(me.yaw) * 4);
      const dir = off.clone().normalize();
      const hit = rayWorld(tmpV.toArray(), dir.toArray(), off.length(), world.colliders);
      camera.position.copy(tmpV).addScaledVector(dir, Math.max(0.5, hit.t - 0.2));
      camera.lookAt(tmpV);
    }
  }

  // local character follows the controller
  myChar.update(dt, {
    pos: [me.pos.x, me.pos.y, me.pos.z], yaw: me.yaw + me.recoilYaw, pitch: me.pitch + me.recoil,
    vel: [me.vel.x, me.vel.z], crouch: me.crouch, aim: me.adsActive, weapon: me.weapon,
  });
  // looking through the sniper scope: first person + scope overlay
  const scoped = me.scoped;
  if (scoped !== wasScoped) {
    wasScoped = scoped;
    $('scope').classList.toggle('on', scoped);
    myChar.setVisible(!scoped && me.alive);
  }

  // remote players: smooth toward the latest snapshot
  const k = 1 - Math.exp(-dt * 16);
  const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  for (const r of remotes.values()) {
    if (r.alive) {
      const prev = r.pos.clone();
      r.pos.lerp(r.target, k);
      let dy = r.tYaw - r.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      r.yaw += dy * k; r.pitch += (r.tPitch - r.pitch) * k;
      const vx = (r.pos.x - prev.x) / dt, vz = (r.pos.z - prev.z) / dt;
      r.vel[0] += (vx - r.vel[0]) * 0.3; r.vel[1] += (vz - r.vel[1]) * 0.3;
      const sp = Math.hypot(r.vel[0], r.vel[1]);
      if (sp > 3.4 && r.pos.y - r.target.y < 0.1) {
        r.step -= dt;
        if (r.step <= 0) { r.step = 0.36; sfx.footstep(r.pos.toArray(), r.team === myTeam ? 0.35 : 0.9); }
      }
    }
    r.char.update(dt, { pos: r.pos.toArray(), yaw: r.yaw, pitch: r.pitch, vel: r.vel, crouch: !!(r.flags & 1), aim: !!(r.flags & 2), weapon: r.w });

    // teammate name plates
    const ally = r.team === myTeam;
    if (ally && r.alive && r.char.root.visible) {
      if (!r.plate) { r.plate = document.createElement('div'); r.plate.className = 'nameplate'; document.body.append(r.plate); }
      r.char.headWorld(tmpV); tmpV.y += 0.35;
      const toP = tmpV.clone().sub(camera.position);
      if (toP.dot(camFwd) > 0) {
        tmpV.project(camera);
        r.plate.style.display = 'block';
        r.plate.style.left = `${(tmpV.x * 0.5 + 0.5) * innerWidth}px`;
        r.plate.style.top = `${(-tmpV.y * 0.5 + 0.5) * innerHeight}px`;
        r.plate.style.color = TEAMS[r.team].color;
        r.plate.textContent = nameOf(r.id);
      } else r.plate.style.display = 'none';
    } else if (r.plate) r.plate.style.display = 'none';
  }

  // screen fog while the camera is inside a smoke
  const fog = fx.smokeAt(camera.position);
  if (Math.abs(fog - smokeFog) > 0.01) { smokeFog = fog; $('smokefog').style.opacity = (fog * 0.97).toFixed(2); }

  sfx.setListener(camera.position.x, camera.position.y, camera.position.z, me.alive ? me.yaw : Math.atan2(-camFwd.x, -camFwd.z));
  fx.update(dt);
  world.tick(clock.elapsedTime);

  sendAcc += dt;
  if (sendAcc >= 0.05 && me.alive) {
    sendAcc = 0;
    net.send({ t: 'u', p: [+me.pos.x.toFixed(3), +me.pos.y.toFixed(3), +me.pos.z.toFixed(3)], ry: +me.yaw.toFixed(3), pi: +me.pitch.toFixed(3), c: me.crouch, w: me.weapon, ad: me.adsActive, a: 0 });
  }
  hudAcc += dt;
  if (hudAcc > 0.05) { hudAcc = 0; updateHud(); drawMinimap(); }

  const tRender = performance.now();
  renderer.render(scene, camera);
  perfTick(tStart, tRender, performance.now());
}

// skip wall decals when the bullet probably hit a player standing in front of the wall
function hitsRemoteFirst(shot, wallT) {
  for (const r of remotes.values()) {
    if (!r.alive || r.team === myTeam) continue;
    const c = r.pos.clone(); c.y += 1.1;
    const toC = c.clone().sub(shot.o);
    const t = toC.dot(shot.d);
    if (t < 0 || t > wallT) continue;
    if (toC.addScaledVector(shot.d, -t).length() < 0.45) return true;
  }
  return false;
}

frame();
