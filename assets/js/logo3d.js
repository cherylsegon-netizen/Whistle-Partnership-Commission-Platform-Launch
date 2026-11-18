// Extruded, lit 3D Whistle logo (mark + wordmark) rendered with three.js.
// Deterministic: nothing animates on its own; callers set state then render.
import * as THREE from 'three';
import { SVGLoader } from '../vendor/SVGLoader.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';

export async function createLogo3D(canvas, { svgUrl, size = 1080 }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(2); // supersample for clean edges
  renderer.setSize(size, size, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(30, 1, 1, 5000);
  camera.position.set(0, 0, 1000);

  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-300, 500, 700); scene.add(key);
  const rim = new THREE.DirectionalLight(0x7fa0ff, 2.6); rim.position.set(600, -200, -300); scene.add(rim);
  const fill = new THREE.PointLight(0xb79cff, 1.4, 0, 0); fill.position.set(400, 300, 500); scene.add(fill);

  const text = await (await fetch(svgUrl)).text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');

  const face = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.15 });
  const side = new THREE.MeshPhysicalMaterial({ color: 0x4a19e4, roughness: 0.3, metalness: 0.45, clearcoat: 0.6, emissive: 0x2a0b8a, emissiveIntensity: 0.35 });
  const mats = [face, side];

  function build(groupId, depth, bevel, useBevel = true) {
    const g = doc.getElementById(groupId);
    const holder = new THREE.Group();
    const loader = new SVGLoader();
    const wrap = `<svg xmlns="http://www.w3.org/2000/svg">${new XMLSerializer().serializeToString(g)}</svg>`;
    const data = loader.parse(wrap);
    const geoms = [];
    for (const p of data.paths) {
      for (const shape of SVGLoader.createShapes(p)) {
        const geo = new THREE.ExtrudeGeometry(shape, {
          depth, bevelEnabled: useBevel, bevelThickness: bevel, bevelSize: bevel * 0.6, bevelSegments: 2, curveSegments: 10,
        });
        geoms.push(geo);
      }
    }
    const meshGroup = new THREE.Group();
    geoms.forEach(geo => meshGroup.add(new THREE.Mesh(geo, mats)));
    // SVG y is down: flip, then centre on own bbox
    meshGroup.scale.set(1, -1, 1);
    const box = new THREE.Box3().setFromObject(meshGroup);
    const c = box.getCenter(new THREE.Vector3());
    meshGroup.position.set(-c.x, -c.y, -c.z);
    holder.add(meshGroup);
    holder.userData.size = box.getSize(new THREE.Vector3());
    holder.userData.center = new THREE.Vector3(c.x, -c.y, 0); // centre in svg coords
    return holder;
  }

  // viewBox units: logo is 105 x 31; scale up so 1 unit ≈ 1px at z=0 with camera at 1000
  const markInner = build('mark', 5, 0.9);
  const wordInner = build('word', 4, 0.7, false); // no bevel: overlapping glyph contours would show seams
  const UNIT = 2.65; // world units per svg unit: lock-up ≈ 560px wide at s=1

  const logo = new THREE.Group();            // whole lock-up
  const mark = new THREE.Group(); mark.add(markInner);
  const word = new THREE.Group(); word.add(wordInner);
  logo.add(mark, word);
  logo.scale.setScalar(UNIT);
  // lock-up positions (relative to lock-up centre), from original layout
  const mc = markInner.userData.center, wc = wordInner.userData.center;
  const lockCx = 105 / 2, lockCy = 31 / 2;
  const markHome = new THREE.Vector3(mc.x - lockCx, -(mc.y - lockCy), 0);
  const wordHome = new THREE.Vector3(wc.x - lockCx, -(wc.y - lockCy), 0);
  // mark children were centred on their own centre; restore lock-up offsets
  mark.position.copy(markHome); word.position.copy(wordHome);
  scene.add(logo);

  // world px per svg unit at z=0: visible height at z=0 = 2*1000*tan(15deg) = 535.9 world units for 1080px
  const PX = 1080 / (2 * 1000 * Math.tan(THREE.MathUtils.degToRad(15)));

  // state: { logo:{x,y,z,rx,ry,rz,s}, mark:{dx,dy,dz,rx,ry,rz,s,o}, word:{dx,dy,dz,rx,ry,rz,s,o} } — x/y in stage px from centre
  function apply(state) {
    const L = state.logo || {};
    logo.position.set((L.x || 0) / PX, -(L.y || 0) / PX, (L.z || 0) / PX);
    logo.rotation.set(L.rx || 0, L.ry || 0, L.rz || 0);
    logo.scale.setScalar(UNIT * (L.s ?? 1));
    for (const [grp, home, st] of [[mark, markHome, state.mark || {}], [word, wordHome, state.word || {}]]) {
      grp.position.set(home.x + (st.dx || 0), home.y + (st.dy || 0), home.z + (st.dz || 0));
      grp.rotation.set(st.rx || 0, st.ry || 0, st.rz || 0);
      grp.scale.setScalar(st.s ?? 1);
      grp.visible = (st.o ?? 1) > 0.01 && (st.s ?? 1) > 0.001;
    }
    canvas.style.opacity = state.opacity ?? 1;
    key.position.x = -300 + (state.light || 0) * 600;
  }

  return {
    render(state) { apply(state); renderer.render(scene, camera); },
    // offsets (svg units) that centre the mark / wordmark alone on the lock-up origin
    markCentre: -markHome.x, wordCentre: -wordHome.x,
  };
}
