// Animated soldier with procedural aiming: spine pitch, leg twist for strafing, crouch via leg IK,
// and two-bone arm IK so both hands stay on the weapon.
import * as THREE from 'three';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { assets } from './assets.js';
import { TEAMS } from './shared.js';

export const TUNE = {
  modelYaw: 0,             // Soldier.glb already faces -Z (our forward)
  weaponScale: { rifle: 0.78, pistol: 0.9, sniper: 0.78, knife: 1.0, grenade: 1.3 },
  twist: -0.38,            // bladed stance: right shoulder back, left shoulder forward
  rifleHip: [0.11, 0.0, -0.26],    // weapon grip position relative to chest, in aim space (x right, y up, -z forward)
  rifleAds: [0.08, 0.07, -0.24],
  pistolHip: [0.04, 0.06, -0.34],
  knifeHip: [0.2, -0.12, -0.3],
  grenadeHip: [0.2, -0.06, -0.28],
  rightGrip: { rifle: [0.0, -0.05, 0.07], pistol: [0.0, -0.06, 0.05], sniper: [0.0, -0.05, 0.07], knife: [0.0, -0.01, 0.075], grenade: [0.0, -0.03, 0.06] },
  leftGrip: { rifle: [-0.01, -0.06, -0.3], pistol: [-0.03, -0.08, 0.04], sniper: [-0.01, -0.05, -0.34] },
  rightPole: [0.7, -0.7, 0.3],
  leftPole: [-0.6, -0.8, -0.1],
  spinePitch: [0.25, 0.3, 0.3],
};
if (typeof window !== 'undefined') window.__tune = TUNE;

const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V(), _d = V(), _e = V(), _t = V(), _p = V();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion(), _qd = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const _qDelta = new THREE.Quaternion(), _qAim = new THREE.Quaternion(), _qRoot = new THREE.Quaternion();
const _fwd = V(), _right = V();

function rotateBoneWorld(bone, delta) {
  bone.parent.getWorldQuaternion(_qa);
  bone.getWorldQuaternion(_qb);
  _qc.copy(delta).multiply(_qb);
  bone.quaternion.copy(_qa.invert().multiply(_qc));
  bone.updateMatrixWorld(true);
}

function solveTwoBone(upper, lower, end, target, pole) {
  const a = upper.getWorldPosition(_a), b = lower.getWorldPosition(_b), c = end.getWorldPosition(_c);
  const lab = a.distanceTo(b), lbc = b.distanceTo(c);
  const dir = _d.subVectors(target, a);
  const lat = THREE.MathUtils.clamp(dir.length(), 0.01, lab + lbc - 0.002);
  dir.normalize();
  const pd = _e.subVectors(pole, a);
  pd.addScaledVector(dir, -pd.dot(dir)).normalize();
  const cosA = THREE.MathUtils.clamp((lab * lab + lat * lat - lbc * lbc) / (2 * lab * lat), -1, 1);
  const elbow = _p.copy(a).addScaledVector(dir, cosA * lab).addScaledVector(pd, Math.sqrt(1 - cosA * cosA) * lab);
  const from = _t.subVectors(b, a).normalize();
  const to = elbow.sub(a).normalize();
  rotateBoneWorld(upper, _qd.setFromUnitVectors(from, to));
  lower.getWorldPosition(_b); end.getWorldPosition(_c);
  const from2 = _t.subVectors(_c, _b).normalize();
  const to2 = _e.subVectors(target, _b).normalize();
  rotateBoneWorld(lower, _qd.setFromUnitVectors(from2, to2));
}

export class Character {
  constructor(scene, team) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.model = skClone(assets.soldier.scene);
    this.model.rotation.y = TUNE.modelYaw;
    this.root.add(this.model);
    scene.add(this.root);

    this.mats = [];
    this.model.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        o.material = o.material.clone();
        this.mats.push(o.material);
      }
    });
    const bone = n => this.model.getObjectByName('mixamorig' + n);
    this.b = {
      hips: bone('Hips'), spine: bone('Spine'), spine1: bone('Spine1'), spine2: bone('Spine2'), neck: bone('Neck'), head: bone('Head'),
      rArm: bone('RightArm'), rFore: bone('RightForeArm'), rHand: bone('RightHand'),
      lArm: bone('LeftArm'), lFore: bone('LeftForeArm'), lHand: bone('LeftHand'),
      rUp: bone('RightUpLeg'), rLeg: bone('RightLeg'), rFoot: bone('RightFoot'),
      lUp: bone('LeftUpLeg'), lLeg: bone('LeftLeg'), lFoot: bone('LeftFoot'),
    };

    this.mixer = new THREE.AnimationMixer(this.model);
    const clip = n => assets.soldier.animations.find(a => a.name === n);
    this.actions = {};
    for (const n of ['Idle', 'Walk', 'Run']) {
      const act = this.mixer.clipAction(clip(n));
      act.play(); act.setEffectiveWeight(n === 'Idle' ? 1 : 0);
      this.actions[n] = act;
    }

    this.weapons = {};
    for (const [w, src] of Object.entries(assets.weapons)) {
      const g = src.clone(true);
      g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
      g.visible = false;
      g.scale.setScalar(TUNE.weaponScale[w] || 1);
      this.root.add(g);
      this.weapons[w] = g;
    }
    this.weapon = 'rifle';
    this.weapons.rifle.visible = true;

    this.legYaw = 0;
    this.crouchT = 0;
    this.aimT = 0;
    this.dead = false;
    this.deathT = 0;
    this.setTeam(team);
  }

  setTeam(team) {
    this.team = team;
    const t = TEAMS[team].tint;
    for (const m of this.mats) m.color.setRGB(t[0], t[1], t[2]);
  }

  setWeapon(w) {
    if (!this.weapons[w] || w === this.weapon) return;
    this.weapons[this.weapon].visible = false;
    this.weapon = w;
    this.weapons[w].visible = !this.dead;
  }

  muzzleWorld(out) {
    const g = this.weapons[this.weapon];
    const m = g.getObjectByName('Muzzle');
    return (m || g).getWorldPosition(out);
  }

  headWorld(out) { return this.b.head.getWorldPosition(out); }

  setVisible(v) { this.root.visible = v; }

  die(dir) {
    this.dead = true; this.deathT = 0;
    this.deathDir = dir ? Math.atan2(-dir[0], -dir[2]) : null;
    for (const w of Object.values(this.weapons)) w.visible = false;
  }

  revive() {
    this.dead = false;
    this.model.rotation.set(0, TUNE.modelYaw, 0);
    this.model.position.set(0, 0, 0);
    this.weapons[this.weapon].visible = true;
  }

  dispose() {
    this.scene.remove(this.root);
    for (const m of this.mats) m.dispose();
  }

  /**
   * s: { pos:[x,y,z], yaw, pitch, vel:[x,z] (world), crouch, aim, weapon }
   */
  update(dt, s) {
    const root = this.root;
    root.position.set(s.pos[0], s.pos[1], s.pos[2]);

    if (this.dead) {
      this.deathT = Math.min(1, this.deathT + dt * 2.2);
      const e = 1 - Math.pow(1 - this.deathT, 3);
      this.model.rotation.set(-e * Math.PI / 2 * 0.95, TUNE.modelYaw, 0, 'YXZ');
      this.model.position.y = 0.15 * e;
      this.mixer.update(dt * (1 - e));
      return;
    }

    root.rotation.set(0, s.yaw, 0);
    this.setWeapon(s.weapon);

    // ---- locomotion blend
    const fwd = _fwd.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    const right = _right.set(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
    const vf = s.vel[0] * fwd.x + s.vel[1] * fwd.z;
    const vr = s.vel[0] * right.x + s.vel[1] * right.z;
    const speed = Math.hypot(s.vel[0], s.vel[1]);
    const back = vf < -0.2;
    let targetYaw = 0;
    if (speed > 0.4) {
      targetYaw = Math.atan2(-vr, Math.abs(vf)) * (back ? -1 : 1);
      targetYaw = THREE.MathUtils.clamp(targetYaw, -1.1, 1.1);
    }
    this.legYaw += (targetYaw - this.legYaw) * Math.min(1, dt * 10);

    const wWalk = THREE.MathUtils.clamp(speed / 2.2, 0, 1) * (speed < 3.4 ? 1 : THREE.MathUtils.clamp((4.6 - speed) / 1.2, 0, 1));
    const wRun = THREE.MathUtils.clamp((speed - 3.0) / 1.6, 0, 1);
    const wIdle = Math.max(0, 1 - wWalk - wRun);
    const dir = back ? -1 : 1;
    this.actions.Idle.setEffectiveWeight(wIdle);
    this.actions.Walk.setEffectiveWeight(wWalk);
    this.actions.Run.setEffectiveWeight(wRun);
    this.actions.Walk.timeScale = dir * Math.max(0.6, speed / 1.5);
    this.actions.Run.timeScale = dir * Math.max(0.7, speed / 5.2);
    this.mixer.update(dt);
    root.updateMatrixWorld(true);

    const b = this.b;
    // ---- strafe twist: legs follow movement, torso keeps facing aim
    if (Math.abs(this.legYaw) > 0.01) {
      rotateBoneWorld(b.hips, _qDelta.setFromAxisAngle(UP, this.legYaw));
      rotateBoneWorld(b.spine, _qDelta.setFromAxisAngle(UP, -this.legYaw * 0.6));
      rotateBoneWorld(b.spine1, _qDelta.setFromAxisAngle(UP, -this.legYaw * 0.4));
    }

    // ---- crouch: drop the hips and solve legs back to the feet
    this.crouchT += ((s.crouch ? 1 : 0) - this.crouchT) * Math.min(1, dt * 12);
    if (this.crouchT > 0.01) {
      const lf = b.lFoot.getWorldPosition(V()), rf = b.rFoot.getWorldPosition(V());
      const hp = b.hips.getWorldPosition(V());
      hp.y -= 0.42 * this.crouchT;
      hp.addScaledVector(fwd, -0.08 * this.crouchT);
      b.hips.parent.worldToLocal(hp);
      b.hips.position.copy(hp);
      b.hips.updateMatrixWorld(true);
      rotateBoneWorld(b.spine, _qDelta.setFromAxisAngle(right, -0.25 * this.crouchT));
      const kneeFwd = V().copy(fwd).multiplyScalar(2);
      solveTwoBone(b.lUp, b.lLeg, b.lFoot, lf, V().copy(b.lLeg.getWorldPosition(V())).add(kneeFwd));
      solveTwoBone(b.rUp, b.rLeg, b.rFoot, rf, V().copy(b.rLeg.getWorldPosition(V())).add(kneeFwd));
    }

    // ---- upper body pitch
    const pitch = THREE.MathUtils.clamp(s.pitch, -1.3, 1.3);
    const sp = TUNE.spinePitch;
    rotateBoneWorld(b.spine, _qDelta.setFromAxisAngle(right, pitch * sp[0] + 0.25 * this.crouchT));
    rotateBoneWorld(b.spine1, _qDelta.setFromAxisAngle(right, pitch * sp[1]));
    rotateBoneWorld(b.spine2, _qDelta.setFromAxisAngle(right, pitch * sp[2]));

    // ---- bladed stance (head keeps looking forward)
    const long = this.weapon === 'rifle' || this.weapon === 'sniper';
    const tw = TUNE.twist * (long ? 1 : this.weapon === 'knife' || this.weapon === 'grenade' ? 0.1 : 0.3);
    rotateBoneWorld(b.spine1, _qDelta.setFromAxisAngle(UP, tw * 0.4));
    rotateBoneWorld(b.spine2, _qDelta.setFromAxisAngle(UP, tw * 0.6));
    rotateBoneWorld(b.neck, _qDelta.setFromAxisAngle(UP, -tw * 0.7));

    // ---- weapon placement in aim space
    this.aimT += ((s.aim ? 1 : 0) - this.aimT) * Math.min(1, dt * 14);
    const qAim = _qAim.setFromEuler(new THREE.Euler(pitch, s.yaw, 0, 'YXZ'));
    const chest = b.spine2.getWorldPosition(V());
    const w = this.weapon;
    const off = V();
    if (long) off.fromArray(TUNE.rifleHip).lerp(V().fromArray(TUNE.rifleAds), this.aimT);
    else if (w === 'knife') off.fromArray(TUNE.knifeHip);
    else if (w === 'grenade') off.fromArray(TUNE.grenadeHip);
    else off.fromArray(TUNE.pistolHip);
    // knife swing: light = sideways slash, heavy = forward stab
    let swingU = 0;
    if (this.swingT > 0) {
      this.swingT = Math.max(0, this.swingT - dt);
      swingU = 1 - this.swingT / this.swingDur;
      const arc = Math.sin(swingU * Math.PI);
      if (this.swingHeavy) { off.z -= arc * 0.42; off.y += arc * 0.08; off.x -= arc * 0.12; }
      else { off.x += 0.12 - swingU * 0.5; off.y += 0.14 - swingU * 0.24; off.z -= arc * 0.22; }
    }
    const kick = this.kick || 0;
    off.z += kick * 0.05; off.y += kick * 0.01;
    this.kick = Math.max(0, kick - dt * 10);
    const gunWorld = chest.add(off.applyQuaternion(qAim));
    const gun = this.weapons[w];
    gun.position.copy(root.worldToLocal(gunWorld.clone()));
    root.getWorldQuaternion(_qRoot);
    const gunQ = _qRoot.invert().multiply(qAim);
    gun.quaternion.copy(gunQ);
    if (kick > 0) gun.rotateX(kick * (w === 'sniper' ? 0.25 : 0.08));
    if (w === 'knife') {
      gun.rotateX(-0.35); // blade angled slightly down at rest
      if (this.swingT > 0 && !this.swingHeavy) gun.rotateY(0.9 - swingU * 1.8);
    }
    gun.updateMatrixWorld(true);

    // ---- hands on the weapon
    const rT = gun.localToWorld(V().fromArray(TUNE.rightGrip[w]));
    const lT = gun.localToWorld(V().fromArray(TUNE.leftGrip[w] || [0, 0, 0]));
    const ch = b.spine2.getWorldPosition(V());
    const rPole = ch.clone().add(V().fromArray(TUNE.rightPole).applyQuaternion(qAim));
    const lPole = ch.clone().add(V().fromArray(TUNE.leftPole).applyQuaternion(qAim));
    solveTwoBone(b.rArm, b.rFore, b.rHand, rT, rPole);
    if (TUNE.leftGrip[w]) solveTwoBone(b.lArm, b.lFore, b.lHand, lT, lPole);
  }

  swing(heavy) {
    this.swingHeavy = heavy;
    this.swingDur = this.swingT = heavy ? 0.42 : 0.28;
  }
}
