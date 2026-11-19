import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { PROP_DIMS } from './shared.js';

export const assets = { soldier: null, weapons: {}, props: {}, textures: {}, sky: null };

export async function loadAll(onProgress) {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => onProgress(loaded / total);
  const gltf = new GLTFLoader(manager);
  const tex = new THREE.TextureLoader(manager);
  const rgbe = new RGBELoader(manager);

  const jobs = [];
  jobs.push(gltf.loadAsync('assets/models/Soldier.glb').then(g => { assets.soldier = g; }));
  for (const w of ['rifle', 'pistol', 'sniper', 'knife', 'grenade']) {
    jobs.push(gltf.loadAsync(`assets/models/${w}.glb`).then(g => { assets.weapons[w] = g.scene; }));
  }
  for (const name of Object.keys(PROP_DIMS)) {
    // prefer the low-poly game version made by tools/optimize_props.py
    jobs.push(gltf.loadAsync(`assets/models/${name}/${name}_game.glb`)
      .catch(() => gltf.loadAsync(`assets/models/${name}/${name}.gltf`))
      .then(g => { assets.props[name] = g.scene; })
      .catch(() => { console.warn('missing prop', name); }));
  }
  for (const slot of ['ground', 'wall', 'brick', 'floor']) {
    const set = {};
    for (const kind of ['diff', 'nor', 'rough']) {
      jobs.push(tex.loadAsync(`assets/textures/${slot}_${kind}.jpg`).then(t => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        if (kind === 'diff') t.colorSpace = THREE.SRGBColorSpace;
        set[kind] = t;
      }).catch(() => console.warn('missing texture', slot, kind)));
    }
    assets.textures[slot] = set;
  }
  jobs.push(rgbe.loadAsync('assets/hdri/sky.hdr').then(t => {
    t.mapping = THREE.EquirectangularReflectionMapping;
    assets.sky = t;
  }).catch(() => console.warn('missing sky')));
  await Promise.all(jobs);
  return assets;
}
