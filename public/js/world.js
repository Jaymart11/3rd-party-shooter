import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAP, buildColliders } from './shared.js';
import { assets } from './assets.js';

// metres covered by one repeat of each texture
const TEX_SCALE = { wall: 2.4, brick: 2.2, floor: 2.5, jump: 2.5, ground: 5 };

function material(slot, renderer, extra = {}) {
  const t = assets.textures[slot] || {};
  const aniso = renderer.capabilities.getMaxAnisotropy();
  for (const k of Object.values(t)) k.anisotropy = Math.min(8, aniso);
  return new THREE.MeshStandardMaterial({
    map: t.diff || null, normalMap: t.nor || null, roughnessMap: t.rough || null,
    roughness: 1, metalness: 0, color: 0xffffff, ...extra,
  });
}

// Box with UVs in world units so textures keep their real-world scale on any size.
function worldBox(w, h, d, scale) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] / scale, uv.getY(i) * dims[f][1] / scale);
    }
  }
  return g;
}

export function buildWorld(scene, renderer, gfx) {
  const high = gfx === 'high';

  // sky + image based lighting from the HDRI
  if (assets.sky) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(assets.sky).texture;
    scene.background = assets.sky;
    scene.backgroundIntensity = 0.9;
    scene.environmentIntensity = 1.0;
    pmrem.dispose();
  } else {
    scene.background = new THREE.Color(0x9cc4e4);
  }
  scene.fog = new THREE.Fog(0xc9d6e2, 60, 220);

  // materials shared by every map; the concrete-block texture is dark, so its tint goes above 1.
  // 'jump' = orange-painted concrete marking walls made for wall-jumping.
  const tint = (r, g, b) => new THREE.Color(r, g, b);
  const mats = {
    ground: material('ground', renderer),
    wall: material('wall', renderer, { color: tint(2.1, 2.0, 1.9) }),
    brick: material('brick', renderer, { color: tint(1, 1, 1) }),
    floor: material('floor', renderer, { color: tint(0.95, 0.93, 0.9) }),
    jump: material('floor', renderer, { color: tint(1.7, 0.78, 0.22) }),
  };

  const sun = new THREE.DirectionalLight(0xfff0dc, 3.0);
  sun.position.set(-30, 55, 22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
  const sc = sun.shadow.camera;
  sc.left = -58; sc.right = 58; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 160;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x8a7a65, 0.6));

  const outer = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x8d7a60, roughness: 1 }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02;
  outer.receiveShadow = true;
  scene.add(outer);

  const pads = [];
  const beamTex = (() => {
    const c = document.createElement('canvas'); c.width = 4; c.height = 128;
    const g = c.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grd; g.fillRect(0, 0, 4, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();

  // everything that belongs to the current map lives in this group, so a map change can swap it out
  let level = null;
  const colliders = []; // shared with the player + effects; refilled in place on map change

  function buildLevel() {
    if (level) {
      scene.remove(level);
      level.traverse(o => { if (o.isMesh && !o.userData.sharedAsset) { o.geometry.dispose(); if (o.material.map?.isCanvasTexture) o.material.map.dispose(); } });
    }
    level = new THREE.Group();
    const half = MAP.half;

    // fit the sun's shadow box to the map
    sc.left = -(half.x + 8); sc.right = half.x + 8; sc.top = half.z + 10; sc.bottom = -(half.z + 10);
    sc.updateProjectionMatrix();

    // ground: textured play area
    const gw = half.x * 2 + 4, gd = half.z * 2 + 4;
    const gGeo = new THREE.PlaneGeometry(gw, gd);
    const guv = gGeo.attributes.uv;
    for (let i = 0; i < guv.count; i++) guv.setXY(i, guv.getX(i) * gw / TEX_SCALE.ground, guv.getY(i) * gd / TEX_SCALE.ground);
    const ground = new THREE.Mesh(gGeo, mats.ground);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    level.add(ground);

    // static boxes, merged per material for fewer draw calls
    const byMat = {};
    for (const [cx, y, cz, w, h, d, m] of MAP.boxes) {
      const g = worldBox(w, h, d, TEX_SCALE[m] || 2.5);
      g.translate(cx, y + h / 2, cz);
      (byMat[m] ||= []).push(g);
    }
    for (const [m, geos] of Object.entries(byMat)) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), mats[m] || mats.wall);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      level.add(mesh);
    }

    // Poly Haven props
    for (const [name, x, y, z, rot, sc2] of MAP.props) {
      const src = assets.props[name];
      let obj;
      if (src) {
        obj = src.clone(true);
        obj.traverse(o => { if (o.isMesh) o.userData.sharedAsset = true; });
      } else {
        obj = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x777777 }));
        box.position.y = 0.5; obj.add(box);
      }
      obj.scale.setScalar(sc2);
      obj.rotation.y = THREE.MathUtils.degToRad(rot);
      obj.position.set(x, y, z);
      obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      level.add(obj);
    }

    // team spawn markings on the ground
    for (const [team, color] of [['atk', 0xff5a4e], ['def', 0x47c2ff]]) {
      const sp = MAP.spawns[team];
      const x = sp.reduce((a, p) => a + p[0], 0) / sp.length;
      const shape = new THREE.Shape();
      shape.moveTo(-3, -8); shape.lineTo(3, -8); shape.lineTo(3, 8); shape.lineTo(-3, 8); shape.lineTo(-3, -8);
      const hole = new THREE.Path();
      hole.moveTo(-2.85, -7.85); hole.lineTo(-2.85, 7.85); hole.lineTo(2.85, 7.85); hole.lineTo(2.85, -7.85); hole.lineTo(-2.85, -7.85);
      shape.holes.push(hole);
      const pad = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false }));
      pad.rotation.x = -Math.PI / 2; pad.position.set(x, 0.01, 0);
      level.add(pad);
    }
    // site letters painted on the ground
    for (const [label, [x, z]] of Object.entries(MAP.sites || {})) {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const ctx = c.getContext('2d');
      ctx.fillStyle = 'rgba(255,210,60,0.55)'; ctx.font = 'bold 200px Segoe UI, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 128, 140);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI / 2; m.position.set(x, 0.015, z);
      level.add(m);
    }

    // jump pads: glowing disc + soft beam of light
    pads.length = 0;
    for (const [x, y, z, r] of MAP.pads || []) {
      const g = new THREE.Group();
      g.position.set(x, y + 0.02, z);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 32), new THREE.MeshBasicMaterial({ color: 0x3df2ff, transparent: true, opacity: 0.85 }));
      disc.rotation.x = -Math.PI / 2;
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.12, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.005;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r, 3, 24, 1, true), new THREE.MeshBasicMaterial({ map: beamTex, color: 0x3df2ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 1.5;
      g.add(disc, ring, beam);
      level.add(g);
      pads.push({ disc, beam });
    }

    scene.add(level);
    colliders.length = 0;
    colliders.push(...buildColliders(MAP));
  }

  buildLevel();
  // pulse the jump pads
  function tick(t) {
    for (const p of pads) {
      p.beam.material.opacity = 0.35 + 0.2 * Math.sin(t * 4);
      p.disc.material.opacity = 0.7 + 0.25 * Math.sin(t * 4 + 1);
    }
  }
  return { colliders, sun, rebuild: buildLevel, tick };
}
