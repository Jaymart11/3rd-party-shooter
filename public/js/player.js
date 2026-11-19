import * as THREE from 'three';
import { WEAPONS, MAP, rayWorld, modeWeapons } from './shared.js';

const HALF = 0.3;          // half width of the player's collision box
const STAND_H = 1.8, CROUCH_H = 1.25;
const STEP = 0.45;         // max ledge height we auto-step onto
const GRAVITY = 20, JUMP_V = 6.6;
const SPEED = { run: 5.4, walk: 2.6, crouch: 2.0 };
const DASH = { speed: 19, time: 0.16, cooldown: 0.35, carry: 6 };   // unlimited dashes, just a short gap between them
const WALL_JUMP = { up: 7.2, push: 7, cooldown: 0.2 };
// Air movement (Quake/Source style): air control only ever adds speed along your input direction, so
// strafing while turning the mouse in the air gains speed, and jumping on the landing frame keeps it.
const AIR_ACCEL = 2.2;      // how hard you can steer in the air (up to running speed)
const STRAFE_CAP = 0.8, STRAFE_ACCEL = 12; // Source-style strafe gain: tiny wish speed, sharp acceleration
const AIR_DRAG = 3;         // only with no movement keys held: lets wall-jump pushes settle onto ledges
const BHOP_MAX = 13;        // horizontal speed cap from bunny hopping (dash can still burst past it)
const JUMP_BUFFER = 0.15;   // a jump pressed this long before landing still counts (for bhop timing)
const TUCK = STAND_H - CROUCH_H; // crouching in the air pulls your legs up this much (crouch jump)

export class LocalPlayer {
  constructor(camera, colliders) {
    this.camera = camera;
    this.colliders = colliders;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.recoil = 0; this.recoilYaw = 0;
    this.crouch = false; this.grounded = false;
    this.alive = false; this.frozen = false;
    this.hp = 100;
    this.weapon = 'rifle';
    this.loadout = modeWeapons('standard');
    this.ammo = {};
    this.resetAmmo();
    this.reloading = 0; this.reloadTotal = 0;
    this.cooldown = 0; this.bloom = 0;
    this.aiming = false; this.firing = false; this.triggerHeld = false;
    this.shoulder = 1;
    this.stepTimer = 0;
    this.switchTimer = 0;
    this.keys = new Set();
    this.dashT = 0; this.dashCd = 0; this.jumpQueued = false; this.wallJumpCd = 0; this.jumpBuffer = 0;
    this.rules = { wallJump: true, dash: true }; // match rules from the host
    this.camPos = new THREE.Vector3();
    this.fov = 74;
  }

  setMode(mode) {
    this.loadout = modeWeapons(mode);
    if (!this.loadout.includes(this.weapon)) { this.weapon = this.loadout[0]; this.reloading = 0; }
  }

  get weaponDef() { return WEAPONS[this.weapon]; }
  // sniper aiming = looking through the scope (camera moves to the eye)
  get scoped() { return this.alive && this.aiming && !!this.weaponDef.scope && this.switchTimer <= 0; }
  // right mouse aims with guns; with the knife it is the heavy attack instead
  get adsActive() { return this.aiming && !this.weaponDef.melee && !this.weaponDef.throwable; }

  resetAmmo() {
    for (const [k, w] of Object.entries(WEAPONS)) this.ammo[k] = { mag: w.mag, res: w.reserve };
  }

  spawn(p, ry) {
    this.pos.set(p[0], p[1], p[2]);
    this.vel.set(0, 0, 0);
    this.yaw = ry; this.pitch = 0; this.recoil = 0;
    this.alive = true; this.hp = 100;
    this.reloading = 0;
    this.resetAmmo();
  }

  // Q: quick burst in the direction you are moving (forward if standing still); works in the air too
  dash() {
    if (!this.alive || this.frozen || this.dashCd > 0 || !this.rules.dash) return false;
    const k = this.keys;
    let mx = 0, mz = 0;
    if (k.has('KeyW')) mz -= 1; if (k.has('KeyS')) mz += 1;
    if (k.has('KeyA')) mx -= 1; if (k.has('KeyD')) mx += 1;
    if (!mx && !mz) mz = -1;
    const len = Math.hypot(mx, mz); mx /= len; mz /= len;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    this.vel.x = (mx * cos + mz * sin) * DASH.speed;
    this.vel.z = (-mx * sin + mz * cos) * DASH.speed;
    if (!this.grounded) this.vel.y = Math.max(this.vel.y, 1.2);
    this.dashT = DASH.time; this.dashCd = DASH.cooldown;
    if (this.crouch && !this.overlaps(this.pos.x, this.pos.y, this.pos.z, STAND_H)) this.crouch = false;
    return true;
  }

  // direction pointing away from any wall we are touching (null if none)
  wallNormal() {
    const p = this.pos, h = this.height - 0.3;
    let nx = 0, nz = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (this.overlaps(p.x + dx * 0.25, p.y + 0.2, p.z + dz * 0.25, h)) { nx -= dx; nz -= dz; }
    }
    const len = Math.hypot(nx, nz);
    return len ? { x: nx / len, z: nz / len } : null;
  }

  get height() { return this.crouch ? CROUCH_H : STAND_H; }

  overlaps(px, py, pz, h) {
    for (const b of this.colliders) {
      if (px + HALF > b.min[0] && px - HALF < b.max[0] && pz + HALF > b.min[2] && pz - HALF < b.max[2] &&
          py + h > b.min[1] + 0.001 && py < b.max[1] - 0.001) return b;
    }
    return null;
  }

  moveAxis(axis, delta) {
    if (delta === 0) return;
    const p = this.pos, h = this.height;
    p[axis] += delta;
    const b = this.overlaps(p.x, p.y, p.z, h);
    if (!b) return;
    // try stepping up onto low ledges / crates
    const rise = b.max[1] - p.y;
    if (rise > 0 && rise <= STEP && !this.overlaps(p.x, b.max[1] + 0.001, p.z, h)) {
      p.y = b.max[1] + 0.001;
      return;
    }
    const i = axis === 'x' ? 0 : 2;
    p[axis] = delta > 0 ? b.min[i] - HALF - 0.001 : b.max[i] + HALF + 0.001;
    this.vel[axis] = 0;
  }

  physics(dt, input) {
    const k = this.keys, p = this.pos;
    // ---- crouch. On the ground you stand up only with head room. In the air, crouching tucks your
    // legs up (feet rise, head stays) so a crouch jump clears higher ledges; un-crouching drops them again.
    const wantCrouch = k.has('ControlLeft') || k.has('KeyC');
    if (wantCrouch && !this.crouch) {
      if (!this.grounded && !this.overlaps(p.x, p.y + TUCK, p.z, CROUCH_H)) p.y += TUCK;
      this.crouch = true;
    } else if (!wantCrouch && this.crouch) {
      if (this.grounded) {
        if (!this.overlaps(p.x, p.y, p.z, STAND_H)) this.crouch = false;
      } else if (p.y - TUCK > 0 && !this.overlaps(p.x, p.y - TUCK, p.z, STAND_H)) {
        p.y -= TUCK; this.crouch = false;
      } else if (!this.overlaps(p.x, p.y, p.z, STAND_H)) this.crouch = false;
    }

    let mx = 0, mz = 0;
    if (!this.frozen) {
      if (k.has('KeyW')) mz -= 1; if (k.has('KeyS')) mz += 1;
      if (k.has('KeyA')) mx -= 1; if (k.has('KeyD')) mx += 1;
    }
    const len = Math.hypot(mx, mz) || 1;
    mx /= len; mz /= len;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // local (mx right, mz back) -> world
    const wx = mx * cos + mz * sin;
    const wz = -mx * sin + mz * cos;
    const walking = k.has('ShiftLeft') || this.adsActive;
    const speed = (this.crouch ? SPEED.crouch : walking ? SPEED.walk : SPEED.run) * (this.weaponDef.speedMul || 1);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.wallJumpCd = Math.max(0, this.wallJumpCd - dt);

    // ---- jump input: holding Space bunny hops; a press just before landing is remembered
    const pressedJump = this.jumpQueued; this.jumpQueued = false;
    this.jumpBuffer = pressedJump ? JUMP_BUFFER : Math.max(0, this.jumpBuffer - dt);
    const groundJump = !this.frozen && this.grounded && (k.has('Space') || this.jumpBuffer > 0);

    if (this.dashT > 0) {
      // keep the dash velocity; barely any gravity during the burst
      this.dashT -= dt;
      this.vel.y -= GRAVITY * 0.25 * dt;
      if (this.dashT <= 0) {
        // end of the burst: keep some momentum, not all 19 m/s
        const hs = Math.hypot(this.vel.x, this.vel.z);
        if (hs > DASH.carry) { this.vel.x *= DASH.carry / hs; this.vel.z *= DASH.carry / hs; }
      }
    } else if (this.grounded && !groundJump) {
      // on the ground: quick acceleration / friction toward where you want to go
      const a = Math.min(1, 14 * dt);
      this.vel.x += (wx * speed - this.vel.x) * a;
      this.vel.z += (wz * speed - this.vel.z) * a;
      this.vel.y -= GRAVITY * dt;
    } else {
      // in the air (and on the frame you hop, so landing friction never eats your speed)
      if (mx || mz) {
        // gentle steering, never above running speed in the direction you hold
        let cur = this.vel.x * wx + this.vel.z * wz;
        let add = speed - cur;
        if (add > 0) {
          const acc = Math.min(AIR_ACCEL * speed * dt, add);
          this.vel.x += wx * acc; this.vel.z += wz * acc;
        }
        // strafe gain: holding A/D while turning the mouse the same way keeps your input nearly
        // sideways to your motion, and each step adds a little speed (bunny-hop acceleration)
        cur = this.vel.x * wx + this.vel.z * wz;
        add = STRAFE_CAP - cur;
        if (add > 0) {
          const acc = Math.min(STRAFE_ACCEL * speed * dt, add);
          this.vel.x += wx * acc; this.vel.z += wz * acc;
        }
      } else {
        // hands off the keys in the air: drift to a stop (bunny hoppers always hold a key, so this never touches bhop)
        const d = Math.exp(-AIR_DRAG * dt);
        this.vel.x *= d; this.vel.z *= d;
      }
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (hs > BHOP_MAX) { this.vel.x *= BHOP_MAX / hs; this.vel.z *= BHOP_MAX / hs; }
      this.vel.y -= GRAVITY * dt;
    }

    if (groundJump) {
      this.vel.y = JUMP_V; this.grounded = false; this.jumped = true; this.jumpBuffer = 0;
    } else if (!this.frozen && !this.grounded && pressedJump && this.wallJumpCd <= 0 && this.rules.wallJump) {
      // wall jump: kick off whatever wall we are touching, as many times as you like
      const n = this.wallNormal();
      if (n) {
        this.vel.y = WALL_JUMP.up;
        this.vel.x = n.x * WALL_JUMP.push + this.vel.x * 0.35;
        this.vel.z = n.z * WALL_JUMP.push + this.vel.z * 0.35;
        this.wallJumpCd = WALL_JUMP.cooldown;
        this.jumpBuffer = 0;
        this.dashT = 0;
        input.onWallJump?.();
      }
    }

    this.moveAxis('x', this.vel.x * dt);
    this.moveAxis('z', this.vel.z * dt);

    // vertical
    p.y += this.vel.y * dt;
    this.grounded = false;
    if (p.y <= 0) { p.y = 0; this.vel.y = 0; this.grounded = true; }
    const b = this.overlaps(p.x, p.y, p.z, this.height);
    if (b) {
      if (this.vel.y <= 0) { p.y = b.max[1] + 0.001; this.vel.y = 0; this.grounded = true; }
      else { p.y = b.min[1] - this.height - 0.001; this.vel.y = 0; }
    } else if (this.vel.y <= 0 && p.y > 0) {
      // standing exactly on top of something?
      if (this.overlaps(p.x, p.y - 0.01, p.z, this.height)) { this.grounded = true; this.vel.y = 0; }
    }
    // jump pads: standing on one throws you straight up
    if (this.grounded && MAP.pads) {
      for (const [x, y, z, r, v] of MAP.pads) {
        if (Math.abs(p.y - y) < 0.2 && Math.hypot(p.x - x, p.z - z) < r + 0.15) {
          this.vel.y = v; this.grounded = false; this.dashT = 0;
          input.onPad?.();
          break;
        }
      }
    }
    p.x = THREE.MathUtils.clamp(p.x, -MAP.half.x + HALF, MAP.half.x - HALF);
    p.z = THREE.MathUtils.clamp(p.z, -MAP.half.z + HALF, MAP.half.z - HALF);

    // footsteps (only when running — walking and crouching are silent)
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.moving = hs;
    if (this.grounded && hs > 3.4) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) { this.stepTimer = 0.36; input.onStep?.(); }
    } else this.stepTimer = Math.min(this.stepTimer, 0.1);
  }

  // over-the-shoulder camera with wall collision
  updateCamera(dt) {
    const ads = this.adsActive && this.alive;
    const scoped = this.scoped;
    const crouchDrop = this.crouch ? 0.45 : 0;
    const pivot = new THREE.Vector3(this.pos.x, this.pos.y + 1.55 - crouchDrop, this.pos.z);
    const side = (ads ? 0.42 : 0.58) * this.shoulder;
    // scoped: camera sits at the eye (first person through the scope)
    const off = scoped ? new THREE.Vector3(0, 0.12, 0.05) : new THREE.Vector3(side, ads ? 0.12 : 0.22, ads ? 1.25 : 2.5);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch + this.recoil, this.yaw + this.recoilYaw, 0, 'YXZ'));
    off.applyQuaternion(q);
    const dist = off.length();
    const dir = off.clone().divideScalar(dist);
    const hit = rayWorld(pivot.toArray(), dir.toArray(), dist + 0.25, this.colliders);
    const d = Math.max(0.3, Math.min(dist, hit.t - 0.25));
    const target = pivot.clone().addScaledVector(dir, d);
    this.camPos.lerp(target, 1 - Math.exp(-dt * 30));
    if (this.camPos.distanceTo(target) > 1.5 || scoped) this.camPos.copy(target);
    this.camera.position.copy(this.camPos);
    this.camera.quaternion.copy(q);
    const fovTarget = scoped ? this.weaponDef.scopeFov : (ads ? (this.weapon === 'rifle' ? 50 : 60) : 74) + (this.dashT > 0 ? 9 : 0);
    this.fov += (fovTarget - this.fov) * Math.min(1, dt * (scoped ? 30 : 14));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
    this.pivot = pivot;
  }

  get spread() {
    const w = WEAPONS[this.weapon].spread;
    let s = w.base + this.bloom;
    if (w.hip && !this.scoped) s += w.hip; // snipers are wild without the scope
    const hs = Math.hypot(this.vel.x, this.vel.z);
    s += w.move * THREE.MathUtils.clamp((hs - 1.0) / 4, 0, 1);
    if (!this.grounded) s += w.air;
    if (this.crouch) s *= 0.75;
    if (this.adsActive && !w.hip) s *= 0.55;
    return s;
  }

  startReload(sfx, net) {
    const a = this.ammo[this.weapon], w = WEAPONS[this.weapon];
    if (w.melee || w.throwable || this.reloading > 0 || a.mag >= w.mag || a.res <= 0) return;
    this.reloading = this.reloadTotal = w.reload;
    sfx.reload(w.reload);
    net.send({ t: 'reload' });
  }

  switchWeapon(w) {
    if (w === this.weapon || !WEAPONS[w] || !this.loadout.includes(w)) return;
    this.weapon = w; this.reloading = 0; this.switchTimer = WEAPONS[w].melee ? 0.2 : 0.35; this.bloom = 0;
  }

  // returns a shot { o, d } or null
  tryFire(dt, sfx, net) {
    this.cooldown -= dt;
    const w = WEAPONS[this.weapon];
    this.bloom = Math.max(0, this.bloom - w.spread.recover * dt * (this.firing ? 0.2 : 1) * 3);
    if (!this.firing) {
      this.recoil = Math.max(0, this.recoil - dt * 0.45);
      this.recoilYaw *= Math.max(0, 1 - dt * 6);
    }
    if (this.switchTimer > 0) { this.switchTimer -= dt; return null; }
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const a = this.ammo[this.weapon];
        const need = w.mag - a.mag, take = Math.min(need, a.res);
        a.mag += take; a.res -= take;
      }
      return null;
    }
    if (w.throwable) {
      // left click = full throw, right click = short lob; unlimited grenades, just a short gap
      if ((!this.firing && !this.aiming) || this.cooldown > 0 || this.frozen) return null;
      this.cooldown = w.fireInterval;
      return { throw: true, lob: !this.firing && this.aiming };
    }
    if (w.melee) {
      // left click = quick slash, right click = heavy stab
      if ((!this.firing && !this.aiming) || this.cooldown > 0 || this.frozen) return null;
      const heavy = !this.firing && this.aiming;
      this.cooldown = heavy ? w.heavyInterval : w.fireInterval;
      return { melee: true, heavy };
    }
    if (!this.firing || this.cooldown > 0 || this.frozen) return null;
    if (!w.auto && this.triggerHeld) return null;
    const a = this.ammo[this.weapon];
    if (a.mag <= 0) { if (!this.triggerHeld) sfx.dry(); this.triggerHeld = true; this.startReload(sfx, net); return null; }
    this.triggerHeld = true;
    a.mag--;
    this.cooldown = w.fireInterval;

    // aim ray goes through the crosshair, starting level with the player so walls behind us don't block it
    const cam = this.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const t0 = Math.max(0, new THREE.Vector3().subVectors(this.pivot, cam.position).dot(fwd));
    const o = cam.position.clone().addScaledVector(fwd, t0);
    const s = this.spread;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const ang = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * s;
    const d = fwd.clone().addScaledVector(right, Math.cos(ang) * r).addScaledVector(up, Math.sin(ang) * r).normalize();

    this.bloom = Math.min(w.spread.maxBloom, this.bloom + w.spread.bloom);
    this.recoil = Math.min(0.2, this.recoil + w.recoil * (0.7 + Math.random() * 0.3));
    this.recoilYaw += (Math.random() - 0.5) * w.recoil * 0.8;
    if (a.mag === 0) setTimeout(() => this.startReload(sfx, net), 150);
    return { o, d };
  }
}
