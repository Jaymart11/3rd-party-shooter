import * as THREE from 'three';
import { nadeStep, NADE_DT, WEAPONS } from './shared.js';
import { assets } from './assets.js';

function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const softTex = canvasTex(128, (g, s) => {
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.4, 'rgba(255,255,255,0.6)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, s, s);
});
const flashTex = canvasTex(128, (g, s) => {
  g.translate(s / 2, s / 2);
  const r = g.createRadialGradient(0, 0, 0, 0, 0, s / 2);
  r.addColorStop(0, 'rgba(255,255,230,1)'); r.addColorStop(0.25, 'rgba(255,200,90,0.9)'); r.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = r;
  for (let i = 0; i < 6; i++) { g.rotate(Math.PI / 3); g.beginPath(); g.moveTo(0, -6); g.lineTo(s / 2, 0); g.lineTo(0, 6); g.fill(); }
  g.beginPath(); g.arc(0, 0, s / 5, 0, Math.PI * 2); g.fill();
});
const holeTex = canvasTex(64, (g, s) => {
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  r.addColorStop(0, 'rgba(10,8,6,1)'); r.addColorStop(0.35, 'rgba(20,16,12,0.9)'); r.addColorStop(0.6, 'rgba(60,50,40,0.35)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, s, s);
});

const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

export class Effects {
  constructor(scene, colliders) {
    this.scene = scene;
    this.colliders = colliders;
    this.live = [];
    this.smokes = [];
    this.nades = [];

    this.tracerGeo = new THREE.CylinderGeometry(0.01, 0.01, 1, 5, 1, true);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flashMat = new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.dustMat = new THREE.SpriteMaterial({ map: softTex, color: 0xb9ab95, transparent: true, depthWrite: false });
    this.bloodMat = new THREE.SpriteMaterial({ map: softTex, color: 0x8a0d0d, transparent: true, depthWrite: false });
    this.sparkMat = new THREE.SpriteMaterial({ map: softTex, color: 0xffc070, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    this.holeGeo = new THREE.PlaneGeometry(0.09, 0.09);
    this.holeMat = new THREE.MeshBasicMaterial({ map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.holes = [];

    // fixed pool of flash lights (constant light count = no shader recompiles)
    this.lights = [];
    for (let i = 0; i < 1; i++) { // every extra point light costs shading on every pixel
      const l = new THREE.PointLight(0xffb060, 0, 7, 2);
      scene.add(l); this.lights.push({ l, t: 0 });
    }
    this.lightIdx = 0;
    this.frags = new Map();
    this.scorchMat = new THREE.MeshBasicMaterial({ map: holeTex, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.smokeDarkMat = new THREE.SpriteMaterial({ map: softTex, color: 0x4a4540, transparent: true, depthWrite: false });
  }

  add(obj, life, update) { this.scene.add(obj); this.live.push({ obj, life, t: 0, update }); }

  tracer(from, to) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 0.5) return;
    const m = new THREE.Mesh(this.tracerGeo, this.tracerMat.clone());
    // short streak travelling along the path
    const streak = Math.min(len, 6);
    m.scale.set(1, streak, 1);
    m.quaternion.setFromUnitVectors(Y, dir.clone().normalize());
    const speed = 380;
    this.add(m, Math.max(0.05, len / speed), (o, t, life) => {
      const d = Math.min(len - streak / 2, streak / 2 + t * speed);
      o.position.copy(from).addScaledVector(dir, d / len);
      o.material.opacity = 0.9 * (1 - t / life);
    });
  }

  muzzle(pos, dir) {
    const s = new THREE.Sprite(this.flashMat);
    s.position.copy(pos).addScaledVector(dir, 0.05);
    const sz = 0.22 + Math.random() * 0.15;
    s.scale.set(sz, sz, 1);
    s.material.rotation = Math.random() * Math.PI;
    this.add(s, 0.045);
    const L = this.lights[this.lightIdx++ % this.lights.length];
    L.l.position.copy(pos); L.l.intensity = 6; L.t = 0.05;
  }

  impact(pos, normal, kind = 'wall') {
    const n = normal ? new THREE.Vector3().fromArray(normal) : new THREE.Vector3(0, 1, 0);
    const mat = kind === 'blood' ? this.bloodMat : this.dustMat;
    for (let i = 0; i < (kind === 'blood' ? 5 : 3); i++) {
      const s = new THREE.Sprite(mat.clone());
      const v = n.clone().multiplyScalar(0.6 + Math.random()).add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5));
      s.position.copy(pos);
      this.add(s, 0.45 + Math.random() * 0.3, (o, t, life) => {
        o.position.addScaledVector(v, 0.016);
        const k = t / life;
        const sz = 0.08 + k * (kind === 'blood' ? 0.35 : 0.55);
        o.scale.set(sz, sz, 1);
        o.material.opacity = (1 - k) * 0.8;
      });
    }
    if (kind === 'blood') return;
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Sprite(this.sparkMat);
      const v = n.clone().multiplyScalar(2 + Math.random() * 2).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3));
      s.position.copy(pos); s.scale.set(0.04, 0.04, 1);
      this.add(s, 0.15 + Math.random() * 0.1, (o, t) => { o.position.addScaledVector(v, 0.016); v.y -= 0.3; });
    }
    // bullet hole decal
    const h = new THREE.Mesh(this.holeGeo, this.holeMat);
    h.position.copy(pos).addScaledVector(n, 0.005);
    h.quaternion.setFromUnitVectors(Z, n);
    h.rotateZ(Math.random() * Math.PI);
    this.scene.add(h);
    this.holes.push(h);
    if (this.holes.length > 120) this.scene.remove(this.holes.shift());
  }

  // ----- smoke grenade: deterministic arc simulated identically on every client
  throwSmoke(origin, vel, onPop) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.14, 10), new THREE.MeshStandardMaterial({ color: 0x55606a, metalness: 0.6, roughness: 0.4 }));
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.nades.push({ mesh, p: new THREE.Vector3().fromArray(origin), v: new THREE.Vector3().fromArray(vel), t: 0, acc: 0, onPop });
  }

  stepNade(n) {
    const dt = 1 / 120;
    n.v.y -= 16 * dt;
    const prev = n.p.clone();
    n.p.addScaledVector(n.v, dt);
    if (n.p.y < 0.05) { n.p.y = 0.05; n.v.y *= -0.3; n.v.x *= 0.6; n.v.z *= 0.6; }
    for (const b of this.colliders) {
      const p = n.p;
      if (p.x > b.min[0] && p.x < b.max[0] && p.y > b.min[1] && p.y < b.max[1] && p.z > b.min[2] && p.z < b.max[2]) {
        // reflect on the axis we entered through
        for (let i = 0; i < 3; i++) {
          const a = 'xyz'[i];
          if (prev[a] <= b.min[i] || prev[a] >= b.max[i]) {
            n.v[a] *= -0.35;
            p[a] = prev[a];
            if (i === 1 && prev.y >= b.max[1]) { n.v.x *= 0.6; n.v.z *= 0.6; }
          }
        }
      }
    }
    n.t += dt;
    const resting = n.v.length() < 0.6 && n.t > 0.4;
    return resting || n.t > 2.2;
  }

  // One smoke cloud = one instanced draw call. Puffs are camera-facing quads built in the vertex
  // shader; they fade out close to the camera so standing next to (or in) smoke stays cheap.
  spawnSmoke(pos) {
    const PUFFS = 34;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    const off = new Float32Array(PUFFS * 3), size = new Float32Array(PUFFS), seed = new Float32Array(PUFFS), shade = new Float32Array(PUFFS);
    for (let i = 0; i < PUFFS; i++) {
      // fill a squashed sphere, denser toward the middle
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 - 0.35, Math.random() - 0.5).normalize();
      d.multiplyScalar(i < 6 ? Math.random() * 0.35 : 0.55 + Math.random() * 0.5);
      off.set([d.x, d.y * 0.8, d.z], i * 3);
      size[i] = 2.6 + Math.random() * 2.6;
      seed[i] = Math.random();
      shade[i] = 0.66 + Math.random() * 0.22;
    }
    geo.setAttribute('offset', new THREE.InstancedBufferAttribute(off, 3));
    geo.setAttribute('size', new THREE.InstancedBufferAttribute(size, 1));
    geo.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 1));
    geo.setAttribute('shade', new THREE.InstancedBufferAttribute(shade, 1));
    geo.instanceCount = PUFFS;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { map: { value: softTex }, uRadius: { value: 1 }, uGrow: { value: 0 }, uFade: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `
        attribute vec3 offset; attribute float size; attribute float seed; attribute float shade;
        uniform float uRadius, uGrow, uFade, uTime;
        varying vec2 vUv; varying float vAlpha; varying float vShade;
        void main() {
          vec3 c = offset * uRadius;
          c.y += sin(uTime * 0.4 + seed * 6.28) * 0.15;
          vec4 mv = modelViewMatrix * vec4(c, 1.0);
          float a = seed * 6.28 + uTime * 0.04 * (seed - 0.5);
          vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * position.xy * size * (0.45 + 0.55 * uGrow);
          mv.xy += q;
          gl_Position = projectionMatrix * mv;
          vUv = uv;
          vAlpha = uFade * uGrow * smoothstep(0.6, 3.0, -mv.z);
          vShade = shade * (0.82 + 0.22 * clamp(offset.y * 1.6 + 0.5, 0.0, 1.0)); // darker underneath
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vUv; varying float vAlpha; varying float vShade;
        void main() {
          float a = texture2D(map, vUv).a * vAlpha * 0.95;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(vShade), a);
        }`,
    });
    const puffs = new THREE.Mesh(geo, mat);
    puffs.frustumCulled = false;
    puffs.renderOrder = 2;

    const g = new THREE.Group();
    g.position.copy(pos); g.position.y = Math.max(pos.y, 0) + 1.3;
    // solid-looking core so it really blocks sight (front faces only: invisible from inside)
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshLambertMaterial({ color: 0xb8bdc2, transparent: true, opacity: 0, depthWrite: false }));
    g.add(core, puffs);
    this.scene.add(g);
    this.smokes.push({ g, core, puffs, t: 0, life: 15, R: 4.2 });
  }

  // 0..1: how deep the camera is inside any smoke (for the screen fog)
  smokeAt(p) {
    let k = 0;
    for (const s of this.smokes) {
      const grow = Math.min(1, s.t / 1.2);
      const fade = s.t > s.life - 2 ? Math.max(0, (s.life - s.t) / 2) : 1;
      const r = s.R * (0.3 + 0.7 * grow);
      const dx = p.x - s.g.position.x, dy = (p.y - s.g.position.y) / 0.8, dz = p.z - s.g.position.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      k = Math.max(k, fade * grow * Math.min(1, Math.max(0, (r * 0.95 - d) / (r * 0.35))));
    }
    return k;
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i];
      e.t += dt;
      if (e.update) e.update(e.obj, e.t, e.life);
      if (e.t >= e.life) {
        this.scene.remove(e.obj);
        if (e.obj.material && e.obj.material !== this.flashMat && e.obj.material !== this.sparkMat) e.obj.material.dispose?.();
        this.live.splice(i, 1);
      }
    }
    for (const L of this.lights) { if (L.t > 0) { L.t -= dt; if (L.t <= 0) { L.l.intensity = 0; L.l.distance = 7; } } }
    const fuse = WEAPONS.grenade.fuse;
    for (const [id, f] of this.frags) {
      f.acc += dt;
      while (f.acc >= NADE_DT) { f.acc -= NADE_DT; f.t += NADE_DT; nadeStep(f.p, f.v, this.colliders, NADE_DT); }
      f.mesh.position.set(f.p[0], f.p[1], f.p[2]);
      f.mesh.rotation.x += dt * 9 * Math.min(1, Math.hypot(...f.v) / 4);
      if (f.t > fuse + 1) { this.scene.remove(f.mesh); this.frags.delete(id); } // the boom never arrived
    }

    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i];
      n.acc += dt;
      let done = false;
      while (n.acc >= 1 / 120 && !done) { n.acc -= 1 / 120; done = this.stepNade(n); }
      n.mesh.position.copy(n.p);
      n.mesh.rotation.x += dt * 12;
      if (done) {
        this.scene.remove(n.mesh);
        this.nades.splice(i, 1);
        this.spawnSmoke(n.p);
        n.onPop?.(n.p.clone());
      }
    }

    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.t += dt;
      const grow = Math.min(1, s.t / 1.2);
      const fade = s.t > s.life - 2 ? Math.max(0, (s.life - s.t) / 2) : 1;
      const r = s.R * (0.3 + 0.7 * (1 - Math.pow(1 - grow, 3)));
      s.core.scale.set(r * 0.66, r * 0.56, r * 0.66);
      s.core.material.opacity = 0.97 * fade * grow;
      const u = s.puffs.material.uniforms;
      u.uRadius.value = r; u.uGrow.value = grow; u.uFade.value = fade; u.uTime.value = s.t;
      if (s.t >= s.life) {
        this.scene.remove(s.g);
        s.core.geometry.dispose(); s.core.material.dispose();
        s.puffs.geometry.dispose(); s.puffs.material.dispose();
        this.smokes.splice(i, 1);
      }
    }
  }

  // ----- frag grenades: same physics step as the server, so the flight matches
  throwFrag(id, o, v) {
    const src = assets.weapons.grenade;
    const mesh = src ? src.clone(true) : new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), new THREE.MeshStandardMaterial({ color: 0x34401c }));
    mesh.scale.setScalar(1.3);
    mesh.traverse(m => { if (m.isMesh) m.castShadow = true; });
    this.scene.add(mesh);
    this.frags.set(id, { mesh, p: [...o], v: [...v], acc: 0, t: 0 });
  }

  explode(id, pos) {
    const f = this.frags.get(id);
    if (f) { this.scene.remove(f.mesh); this.frags.delete(id); }
    const at = new THREE.Vector3(pos[0], pos[1] + 0.3, pos[2]);
    // flash
    const L = this.lights[0];
    L.l.position.copy(at); L.l.intensity = 80; L.l.distance = 16; L.t = 0.12;
    // fireball
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Sprite(this.flashMat);
      const off = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(1.2);
      s.position.copy(at).add(off);
      this.add(s, 0.25 + Math.random() * 0.15, (o, t, life) => { const k = t / life; const sz = 1.2 + k * 3.2; o.scale.set(sz, sz, 1); });
    }
    // dark smoke column
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Sprite(this.smokeDarkMat.clone());
      const v = new THREE.Vector3(Math.random() - 0.5, 0.6 + Math.random(), Math.random() - 0.5).multiplyScalar(2.2);
      s.position.copy(at);
      this.add(s, 1.4 + Math.random() * 0.8, (o, t, life) => {
        o.position.addScaledVector(v, 0.016); v.multiplyScalar(0.97);
        const k = t / life, sz = 1 + k * 3.5; o.scale.set(sz, sz, 1); o.material.opacity = 0.75 * (1 - k);
      });
    }
    // sparks / debris
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(this.sparkMat);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize().multiplyScalar(6 + Math.random() * 8);
      s.position.copy(at); s.scale.set(0.08, 0.08, 1);
      this.add(s, 0.4 + Math.random() * 0.4, o => { o.position.addScaledVector(v, 0.016); v.y -= 0.35; });
    }
    // scorch mark on the floor below
    const scorch = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), this.scorchMat);
    scorch.rotation.x = -Math.PI / 2; scorch.rotation.z = Math.random() * 6;
    scorch.position.set(pos[0], pos[1] - 0.03, pos[2]);
    this.scene.add(scorch); this.holes.push(scorch);
    if (this.holes.length > 120) this.scene.remove(this.holes.shift());
  }

  // map change: drop bullet holes, smokes and grenades from the old map
  clearAll() {
    for (const h of this.holes) this.scene.remove(h);
    this.holes.length = 0;
    for (const n of this.nades) this.scene.remove(n.mesh);
    this.nades.length = 0;
    for (const s of this.smokes) s.t = s.life;
    for (const f of this.frags.values()) this.scene.remove(f.mesh);
    this.frags.clear();
  }

  clearRound() {
    for (const s of this.smokes) s.t = Math.max(s.t, s.life - 0.5);
  }
}
