// Shared 3D "At your house" backyard for the customize tools (fence, gate,
// railing, carport). Derived from the pergola page's inline scene — the
// pergola page keeps its own bespoke copy because its yard resizes with the
// design; this one is a fixed layout the tools drop their product into.
// House front face sits at z = 0; products live in +z (the yard).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

export { THREE };

// The property line the fence/gate tools run their fence along. Clears the
// house (x −30..24, z −24..0), the patio (z up to 13.5) and the corner tree.
export const YARD = { x0: -52, x1: 44, z0: -38, z1: 38 };

// The wall an "attached" product bolts to: the two-story wing's front face.
// Tall enough (20 ft) to take any carport height without poking through its roof.
export const HOUSE = { faceZ: 0, wingX: -18, wingW: 24, wingH: 20 };

/**
 * Split a rectangular property line into fence bays.
 *
 * Returns [{ cx, cz, ry, width }] — one per bay, `ry` being the rotation that
 * turns a panel built along local X into a panel lying on that side. Each side
 * divides its own length evenly, so bays land exactly on the corners instead of
 * leaving a ragged last panel.
 *
 * `gap` (optional) opens a hole for a gate: { side: 'front', width, at } — the
 * front run is the one nearest the camera (z = z1), and `at` is where along
 * that run the opening is centred (defaults to mid-side). The two stretches
 * either side of the opening each divide themselves, so the hole is EXACTLY
 * the gate's width and lands exactly where the gate stands.
 */
export function perimeterBays(rect, panelWidth, gap) {
  const { x0, x1, z0, z1 } = rect;
  const sides = [
    { name: 'front', ax: 'x', from: x0, to: x1, fixed: z1, ry: 0 },
    { name: 'back', ax: 'x', from: x0, to: x1, fixed: z0, ry: 0 },
    { name: 'left', ax: 'z', from: z0, to: z1, fixed: x0, ry: Math.PI / 2 },
    { name: 'right', ax: 'z', from: z0, to: z1, fixed: x1, ry: Math.PI / 2 },
  ];
  const bays = [];
  for (const side of sides) {
    const opening = gap && gap.side === side.name ? gap.width : 0;
    let runs = [[side.from, side.to]];
    if (opening > 0) {
      const at = gap.at == null ? side.from + (side.to - side.from) / 2 : gap.at;
      runs = [[side.from, at - opening / 2], [at + opening / 2, side.to]];
    }
    for (const [from, to] of runs) {
      const len = to - from;
      if (len < panelWidth / 4) continue; // opening ate this whole stretch
      const n = Math.max(1, Math.round(len / panelWidth));
      const w = len / n;
      for (let i = 0; i < n; i++) {
        const mid = from + w * (i + 0.5);
        bays.push({
          cx: side.ax === 'x' ? mid : side.fixed,
          cz: side.ax === 'x' ? side.fixed : mid,
          ry: side.ry,
          width: w,
          side: side.name,
        });
      }
    }
  }
  return bays;
}

/**
 * Collect geometry per material and hand back ONE mesh each.
 *
 * A perimeter fence is ~50 bays; built as individual meshes that's a thousand
 * draw calls and a slideshow on a phone. Merging keeps it to a handful.
 * `buckets` is a Map<Material, BufferGeometry[]>; the source geometries are
 * disposed once merged.
 */
export function mergeByMaterial(buckets) {
  const group = new THREE.Group();
  for (const [material, geos] of buckets) {
    if (!geos.length) continue;
    const merged = BufferGeometryUtils.mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}

/**
 * A corrugated sheet as REAL geometry.
 *
 * Bump maps can't do this job: they never touch the silhouette, and on a matte
 * black finish there's almost no diffuse light for them to perturb — which is
 * exactly why corrugated panels read as flat black rectangles no matter how
 * high the bumpScale went.
 *
 * Built in the XY plane (w along X, h along Y) and displaced along Z:
 *   ribAxis 'y' → ribs run VERTICALLY, profile waves along X (fence + gate)
 *   ribAxis 'x' → ribs run horizontally, profile waves along Y (roofs, once
 *                 rotated flat — ribs must run down-slope so water sheds)
 */
export function corrugatedGeometry(w, h, { pitch = 0.3, amp = 0.08, seam = false, ribAxis = 'y' } = {}) {
  const span = ribAxis === 'x' ? h : w; // the axis the profile waves along
  const steps = Math.max(8, Math.min(600, Math.round(span / pitch) * 4));
  const geo = ribAxis === 'x'
    ? new THREE.PlaneGeometry(w, h, 1, steps)
    : new THREE.PlaneGeometry(w, h, steps, 1);
  if (amp > 0) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const u = (ribAxis === 'x' ? pos.getY(i) : pos.getX(i)) / pitch;
      // Standing seam: flat pans with a raised seam. Corrugated: rolling ribs.
      const wave = seam
        ? (Math.abs(((u % 1) + 1) % 1 - 0.5) < 0.09 ? 1 : 0)
        : Math.sin(u * Math.PI * 2) * 0.5 + 0.5;
      pos.setZ(i, wave * amp);
    }
    geo.computeVertexNormals();
  }
  return geo;
}

/** Push `geo` into a material bucket, positioned/rotated into world space. */
export function placeGeo(buckets, geo, material, { x = 0, y = 0, z = 0, ry = 0 } = {}) {
  if (ry) geo.rotateY(ry);
  geo.translate(x, y, z);
  if (!buckets.has(material)) buckets.set(material, []);
  buckets.get(material).push(geo);
}

// Deterministic pseudo-random so the yard looks identical on every load
function lcg(seed) {
  let r = seed;
  return () => (r = (r * 16807) % 2147483647) / 2147483647;
}

// Organic displacement — position-based noise (seam-safe), smooth normals
function organic(geo, amt, seed) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const n = Math.sin(v.x * 5.7 + seed) + Math.sin(v.y * 4.3 + seed * 2) + Math.sin(v.z * 6.1 + seed * 3);
    v.multiplyScalar(1 + (amt * n) / 3);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

// Renderer + camera + controls + lights + shadow ground. Returns null when
// WebGL is unavailable — callers fall back to the 2D preview.
export function createViewer(wrap) {
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const dpr = window.devicePixelRatio || 1;
  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: !(coarse && dpr >= 1.5),
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
  } catch (e) {
    return null;
  }
  renderer.setPixelRatio(Math.min(dpr, coarse ? 1.5 : 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  wrap.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.65;

  const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 600);
  camera.position.set(30, 20, 45);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.minPolarAngle = 0.15;

  // One finger orbits (OrbitControls' default) — the preview is capped at
  // 32vh and sticks to the top, so the page still scrolls everywhere below it.

  scene.add(new THREE.HemisphereLight(0xfff8ee, 0x8a8478, 1.1));
  const key = new THREE.DirectionalLight(0xfff2e2, 1.9);
  key.position.set(28, 42, 18);
  key.castShadow = true;
  key.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
  key.shadow.camera.left = -80;
  key.shadow.camera.right = 80;
  key.shadow.camera.top = 80;
  key.shadow.camera.bottom = -80;
  key.shadow.camera.far = 200;
  key.shadow.bias = -0.0005;
  scene.add(key);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.ShadowMaterial({ opacity: 0.13 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  let active = true;
  const resize = () => {
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(wrap);
  else window.addEventListener('resize', resize);

  renderer.setAnimationLoop(() => {
    if (!active) return;
    controls.update();
    renderer.render(scene, camera);
  });

  // Aim the camera at (cx,cy,cz) fitting `radius`. initial=true sets the
  // opening shot; false is a design edit — the target follows the product
  // but the camera keeps the angle AND the distance the customer chose, so
  // changing an option never yanks the view back out. The min/max clamps
  // still move with the design, so update() pulls them out only if the new
  // size no longer fits where they were standing.
  function frame(cx, cy, cz, radius, initial) {
    const dist = (radius / Math.tan(((camera.fov * Math.PI) / 180) / 2)) * 1.15;
    const held = camera.position.clone().sub(controls.target);
    controls.target.set(cx, cy, cz);
    const dir = initial ? new THREE.Vector3(0.72, 0.38, 1).normalize() : held.clone().normalize();
    camera.position.copy(controls.target).addScaledVector(dir, initial ? dist : held.length());
    controls.minDistance = dist * 0.4;
    controls.maxDistance = dist * 3.2;
    controls.update();
    resize();
  }

  return {
    THREE, renderer, scene, camera, controls, frame,
    setActive(v) { active = v; },
  };
}

// The full yard: sky+fog, lawn, two-story stucco house with hip roofs, stone
// accent, lit windows, planters, hedges, tree — plus a fixed patio with a
// metal dining set.
// opts: { patio: {w,d} | false, furniture: bool, front: bool }
// `front` turns the same house around into a FRONT elevation — entry door and
// two-car garage instead of the sliding patio door, and a driveway running out
// to the property line — for the tools whose product belongs out front (gate).
export function buildBackyard(viewer, opts = {}) {
  const { renderer, scene } = viewer;
  const front = !!opts.front;
  const patioOpt = opts.patio === false ? null : { w: 20, d: 14, ...(opts.patio || {}) };

  const texAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  function canvasTex(size, draw, repX, repY) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repX, repY);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = texAniso;
    return t;
  }

  // Sky — gradient with soft cumulus, plus matching distance fog
  {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#79aedd');
    g.addColorStop(0.55, '#c2dcef');
    g.addColorStop(1, '#edf1ec');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 256);
    const rnd = lcg(21);
    for (let i = 0; i < 7; i++) {
      const cx = rnd() * 512, cy = 30 + rnd() * 90, cr = 24 + rnd() * 42;
      for (let p = 0; p < 5; p++) {
        const px = cx + (rnd() - 0.5) * cr * 2.4, py = cy + (rnd() - 0.5) * cr * 0.5;
        const pr = cr * (0.5 + rnd() * 0.6);
        const cg = ctx.createRadialGradient(px, py, 0, px, py, pr);
        cg.addColorStop(0, 'rgba(255,255,255,0.55)');
        cg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = cg;
        ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
      }
    }
    const sky = new THREE.CanvasTexture(c);
    sky.colorSpace = THREE.SRGBColorSpace;
    scene.background = sky;
    scene.fog = new THREE.Fog(0xe4ecf1, 130, 340);
  }

  // Lawn
  const grassTex = canvasTex(512, (ctx, S) => {
    ctx.fillStyle = '#6f8757';
    ctx.fillRect(0, 0, S, S);
    const rnd = lcg(1);
    for (let i = 0; i < 30; i++) {
      const x = rnd() * S, y = rnd() * S, r = 40 + rnd() * 90;
      const pg = ctx.createRadialGradient(x, y, 0, x, y, r);
      pg.addColorStop(0, rnd() > 0.5 ? 'rgba(96,120,68,0.09)' : 'rgba(136,156,102,0.08)');
      pg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = pg;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const tones = ['#647d4a', '#7d9560', '#5d7647', '#879c6c'];
    ctx.globalAlpha = 0.45;
    for (let i = 0; i < 4200; i++) {
      ctx.fillStyle = tones[i & 3];
      ctx.fillRect(rnd() * S, rnd() * S, 1.6, 2.5 + rnd() * 3);
    }
    ctx.globalAlpha = 1;
  }, 22, 22);
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.05;
  grass.receiveShadow = true;
  scene.add(grass);

  // Concrete (patio + door step)
  const concreteTex = canvasTex(512, (ctx, S) => {
    ctx.fillStyle = '#cfcabb';
    ctx.fillRect(0, 0, S, S);
    const rnd = lcg(7);
    for (let i = 0; i < 14; i++) {
      const x = rnd() * S, y = rnd() * S, r = 40 + rnd() * 80;
      const bg = ctx.createRadialGradient(x, y, 0, x, y, r);
      bg.addColorStop(0, rnd() > 0.5 ? 'rgba(120,112,98,0.07)' : 'rgba(255,255,255,0.07)');
      bg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = rnd() > 0.5 ? '#c5c0b1' : '#d8d3c4';
      ctx.fillRect(rnd() * S, rnd() * S, 2, 2);
    }
    ctx.strokeStyle = 'rgba(90,85,75,0.5)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, S - 3, S - 3);
  }, 1, 1);
  const concreteMat = new THREE.MeshStandardMaterial({ map: concreteTex, bumpMap: concreteTex, bumpScale: 0.02, roughness: 0.95 });

  // ── The house ─────────────────────────────────────────────────────────
  const houseGrp = new THREE.Group();
  const OV = 2;
  const AX = HOUSE.wingX, AW = HOUSE.wingW, AH = HOUSE.wingH;
  const BX = 9, BW = 30, BH = 11;
  const HD = 24;

  const stuccoTex = canvasTex(512, (ctx, S) => {
    ctx.fillStyle = '#ece8df';
    ctx.fillRect(0, 0, S, S);
    const rnd = lcg(11);
    for (let i = 0; i < 26; i++) {
      const x = rnd() * S, y = rnd() * S, r = 30 + rnd() * 70;
      const bg = ctx.createRadialGradient(x, y, 0, x, y, r);
      bg.addColorStop(0, rnd() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(140,132,116,0.05)');
      bg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 7000; i++) {
      ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.14)' : 'rgba(120,112,98,0.09)';
      ctx.fillRect(rnd() * S, rnd() * S, 1.5, 1.5);
    }
    ctx.globalAlpha = 0.05;
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = rnd() > 0.5 ? '#ffffff' : '#b8b0a0';
      ctx.fillRect(rnd() * S - 30, rnd() * S, 60 + rnd() * 120, 1.5 + rnd() * 2);
    }
    ctx.globalAlpha = 1;
  }, 3, 2);
  const shingleTex = canvasTex(512, (ctx, S) => {
    ctx.fillStyle = '#7b7268';
    ctx.fillRect(0, 0, S, S);
    const rows = 8, rh = S / rows;
    const rnd = lcg(3);
    for (let i = 0; i < rows; i++) {
      const y = i * rh;
      const off = (i % 2) * (S / 12);
      for (let x = -1; x < 7; x++) {
        const tone = 0.82 + rnd() * 0.36;
        ctx.fillStyle = `rgb(${Math.round(123 * tone)},${Math.round(114 * tone)},${Math.round(104 * tone)})`;
        ctx.fillRect(x * (S / 6) + off + 2, y, S / 6 - 4, rh - 4);
      }
      ctx.fillStyle = 'rgba(30,26,22,0.5)';
      ctx.fillRect(0, y + rh - 4, S, 4);
    }
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < 5000; i++) {
      const t = 0.7 + rnd() * 0.6;
      ctx.fillStyle = `rgb(${Math.round(120 * t)},${Math.round(112 * t)},${Math.round(100 * t)})`;
      ctx.fillRect(rnd() * S, rnd() * S, 2, 2);
    }
    ctx.globalAlpha = 1;
  }, 1, 1);
  const stoneTex = canvasTex(512, (ctx, S) => {
    ctx.fillStyle = '#8f8b81';
    ctx.fillRect(0, 0, S, S);
    const rnd = lcg(9);
    const rows = 7, rh = S / rows;
    const tones = ['#b9b5ab', '#aaa69c', '#c3bfb5', '#a19d93', '#b1ada3'];
    for (let i = 0; i < rows; i++) {
      let x = -(rnd() * 40);
      while (x < S) {
        const w = 46 + rnd() * 66;
        const base = tones[Math.floor(rnd() * tones.length)];
        const sg = ctx.createLinearGradient(x, i * rh, x + w, i * rh + rh);
        sg.addColorStop(0, base);
        sg.addColorStop(1, 'rgba(120,116,106,0.9)');
        ctx.fillStyle = sg;
        ctx.fillRect(x + 2, i * rh + 2, w - 4, rh - 4);
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x + 2, i * rh + 2, w - 4, 1.5);
        x += w;
      }
    }
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < 3000; i++) {
      ctx.fillStyle = rnd() > 0.5 ? '#ffffff' : '#5c584f';
      ctx.fillRect(rnd() * S, rnd() * S, 2, 2);
    }
    ctx.globalAlpha = 1;
  }, 2.2, 1.7);

  const stuccoMat = new THREE.MeshStandardMaterial({ map: stuccoTex, bumpMap: stuccoTex, bumpScale: 0.02, roughness: 0.9, side: THREE.DoubleSide });
  const darkTrimMat = new THREE.MeshStandardMaterial({ color: 0x2b2b28, roughness: 0.45, metalness: 0.4 });
  const roofMat = new THREE.MeshStandardMaterial({ map: shingleTex, bumpMap: shingleTex, bumpScale: 0.05, roughness: 0.9, side: THREE.DoubleSide });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x4a5a64, metalness: 0.9, roughness: 0.05, envMapIntensity: 1.6 });
  const foundationMat = new THREE.MeshStandardMaterial({ color: 0x7d7a73, roughness: 1 });
  const stoneMat = new THREE.MeshStandardMaterial({ map: stoneTex, bumpMap: stoneTex, bumpScale: 0.08, roughness: 0.95 });
  const leafMatA = new THREE.MeshStandardMaterial({ color: 0x4a6238, roughness: 1 });
  const leafMatB = new THREE.MeshStandardMaterial({ color: 0x556e41, roughness: 1 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5e4a3a, roughness: 1 });

  const volA = new THREE.Mesh(new THREE.BoxGeometry(AW, AH, HD), stuccoMat);
  volA.position.set(AX, AH / 2, -HD / 2);
  volA.castShadow = true;
  houseGrp.add(volA);
  const volB = new THREE.Mesh(new THREE.BoxGeometry(BW, BH, HD), stuccoMat);
  volB.position.set(BX, BH / 2, -HD / 2);
  volB.castShadow = true;
  houseGrp.add(volB);
  const found = new THREE.Mesh(new THREE.BoxGeometry(54.6, 0.4, HD + 0.5), foundationMat);
  found.position.set(-3, 0.2, -HD / 2);
  houseGrp.add(found);

  function hipRoofGeo(w, d, h, hipL, hipR) {
    const x0 = -w / 2, x1 = w / 2, zf = d / 2, zb = -d / 2;
    const r0 = x0 + hipL, r1 = x1 - hipR;
    const eF = [x0, 0, zf], eF1 = [x1, 0, zf];
    const eB = [x0, 0, zb], eB1 = [x1, 0, zb];
    const rA = [r0, h, 0], rB = [r1, h, 0];
    const slope = Math.hypot(d / 2, h);
    const s = 1 / 8;
    const pos = [], uv = [];
    const tri = (a, b, c, ua, ub, uc) => { pos.push(...a, ...b, ...c); uv.push(...ua, ...ub, ...uc); };
    tri(eF, eF1, rB, [x0 * s, 0], [x1 * s, 0], [r1 * s, slope * s]);
    tri(eF, rB, rA, [x0 * s, 0], [r1 * s, slope * s], [r0 * s, slope * s]);
    tri(eB1, eB, rA, [x1 * s, 0], [x0 * s, 0], [r0 * s, slope * s]);
    tri(eB1, rA, rB, [x1 * s, 0], [r0 * s, slope * s], [r1 * s, slope * s]);
    tri(eB, eF, rA, [zb * s, 0], [zf * s, 0], [0, Math.hypot(hipL, h) * s]);
    tri(eF1, eB1, rB, [zf * s, 0], [zb * s, 0], [0, Math.hypot(hipR, h) * s]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }
  const roofD = HD + OV * 2;
  function addHip(cx, w, rise, baseY, hipL, hipR) {
    const roof = new THREE.Mesh(hipRoofGeo(w, roofD, rise, hipL, hipR), roofMat);
    roof.position.set(cx, baseY, -HD / 2);
    roof.castShadow = true;
    houseGrp.add(roof);
    const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.8, roofD + 0.3), darkTrimMat);
    band.position.set(cx, baseY + 0.1, -HD / 2);
    houseGrp.add(band);
  }
  addHip(AX, AW + OV * 2, 4.6, AH, roofD / 2, roofD / 2);
  addHip(10.05, 32, 3.8, BH, 0, roofD / 2);
  const ridgeCap = new THREE.Mesh(new THREE.BoxGeometry(18, 0.22, 0.9), darkTrimMat);
  ridgeCap.position.set(3.05, BH + 3.8 + 0.08, -HD / 2);
  houseGrp.add(ridgeCap);

  const stone = new THREE.Mesh(new THREE.BoxGeometry(14, BH, 0.3), stoneMat);
  stone.position.set(-13, BH / 2, 0.12);
  houseGrp.add(stone);
  const stoneCap = new THREE.Mesh(
    new THREE.BoxGeometry(14.4, 0.35, 0.55),
    new THREE.MeshStandardMaterial({ color: 0xb5b1a7, roughness: 0.9 }),
  );
  stoneCap.position.set(-13, BH + 0.17, 0.15);
  houseGrp.add(stoneCap);
  const belt = new THREE.Mesh(
    new THREE.BoxGeometry(AW + 0.3, 0.8, HD + 0.3),
    new THREE.MeshStandardMaterial({ color: 0xf0ece1, roughness: 0.8 }),
  );
  belt.position.set(AX, BH + 0.55, -HD / 2);
  houseGrp.add(belt);

  const revealMat = new THREE.MeshStandardMaterial({ color: 0x1f1f1e, roughness: 0.9 });
  const litGlassMat = new THREE.MeshStandardMaterial({ color: 0xffe6b8, emissive: 0xffd28a, emissiveIntensity: 0.55, roughness: 0.4 });
  function addWindow(w, h, x, y, z, ry, lit) {
    const g = new THREE.Group();
    const f = 0.22, d = 0.26;
    const reveal = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, h + 0.14, 0.5), revealMat);
    reveal.position.z = -0.3;
    g.add(reveal);
    const bar = (bw, bh, bx, by, bd) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd || d), darkTrimMat);
      m.position.set(bx, by, 0);
      g.add(m);
    };
    bar(w, f, 0, h / 2 - f / 2);
    bar(w, f, 0, -h / 2 + f / 2);
    bar(f, h, -w / 2 + f / 2, 0);
    bar(f, h, w / 2 - f / 2, 0);
    bar(0.1, h - f * 2, 0, 0, d * 0.7);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w - f, h - f), lit ? litGlassMat : glassMat);
    glass.position.z = -0.06;
    g.add(glass);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.14, 0.5), darkTrimMat);
    sill.position.set(0, -h / 2 - 0.07, 0.06);
    g.add(sill);
    g.position.set(x, y, z);
    if (ry) g.rotation.y = ry;
    houseGrp.add(g);
  }
  addWindow(6, 5, -13, 5.9, 0.34);
  addWindow(5, 5, -25, 5.9, 0.16);
  for (const wx of [-25, -18, -11]) addWindow(5, 4.5, wx, 15.6, 0.16, 0, wx === -18);
  // Out front the garage door takes this stretch of wall
  if (!front) for (const wx of [11, 19]) addWindow(6, 5, wx, 5.9, 0.16, 0, wx === 19);
  for (const wx of [-25, -11]) addWindow(5, 4.5, wx, 15.6, -HD - 0.16, Math.PI);
  addWindow(6, 5, 11, 5.9, -HD - 0.16, Math.PI);

  for (const [dx, hgt] of [[-29.7, AH - 0.6], [23.7, BH - 0.6]]) {
    for (const dz of [0.28, -HD - 0.28]) {
      const ds = new THREE.Mesh(new THREE.BoxGeometry(0.28, hgt, 0.28), darkTrimMat);
      ds.position.set(dx, hgt / 2, dz);
      houseGrp.add(ds);
    }
  }

  // The way in: sliding patio door out back, entry door + garage out front
  if (front) {
    const DW = 3.6, DH = 7, DX = -2;
    const reveal = new THREE.Mesh(new THREE.BoxGeometry(DW + 0.5, DH + 0.3, 0.5), revealMat);
    reveal.position.set(DX, 0.4 + DH / 2, -0.06);
    houseGrp.add(reveal);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(DW, DH, 0.22), darkTrimMat);
    leaf.position.set(DX, 0.4 + DH / 2, 0.22);
    houseGrp.add(leaf);
    const lite = new THREE.Mesh(new THREE.PlaneGeometry(DW - 1.5, DH * 0.3), litGlassMat);
    lite.position.set(DX, 0.4 + DH * 0.72, 0.34);
    houseGrp.add(lite);
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xb59a63, metalness: 0.9, roughness: 0.28 }),
    );
    knob.position.set(DX + DW / 2 - 0.45, 3.4, 0.36);
    houseGrp.add(knob);
    const stoop = new THREE.Mesh(new THREE.BoxGeometry(DW + 2.4, 0.4, 2.6), concreteMat);
    stoop.position.set(DX, 0.2, 1.3);
    stoop.receiveShadow = true;
    houseGrp.add(stoop);

    // Two-car garage — panelled door under a dark head trim
    const GW = 16, GH = 8, GX = 10;
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xdedac6, roughness: 0.7 });
    const gdoor = new THREE.Mesh(new THREE.BoxGeometry(GW, GH, 0.3), doorMat);
    gdoor.position.set(GX, GH / 2 + 0.1, 0.2);
    houseGrp.add(gdoor);
    for (let i = 1; i < 4; i++) {
      const groove = new THREE.Mesh(new THREE.BoxGeometry(GW - 0.1, 0.08, 0.34), revealMat);
      groove.position.set(GX, 0.1 + (GH * i) / 4, 0.21);
      houseGrp.add(groove);
    }
    const head = new THREE.Mesh(new THREE.BoxGeometry(GW + 0.7, 0.5, 0.6), darkTrimMat);
    head.position.set(GX, GH + 0.35, 0.25);
    houseGrp.add(head);
  } else {
    const g = new THREE.Group();
    const DW = 10, DH = 6.8, f = 0.28;
    const bar = (bw, bh, bx, by) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.3), darkTrimMat);
      m.position.set(bx, by, 0);
      g.add(m);
    };
    bar(DW, f, 0, DH / 2 - f / 2);
    bar(DW, f, 0, -DH / 2 + f / 2);
    bar(f, DH, -DW / 2 + f / 2, 0);
    bar(f, DH, DW / 2 - f / 2, 0);
    bar(0.14, DH - f * 2, -DW / 6, 0);
    bar(0.14, DH - f * 2, DW / 6, 0);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(DW - f * 2, DH - f * 2), glassMat);
    glass.position.z = -0.05;
    g.add(glass);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.5, 0.12), darkTrimMat);
    handle.position.set(-DW / 6 - 0.32, -0.2, 0.2);
    g.add(handle);
    g.position.set(0, 0.4 + DH / 2, 0.18);
    houseGrp.add(g);
    const step = new THREE.Mesh(new THREE.BoxGeometry(DW + 1, 0.24, 1.6), concreteMat);
    step.position.set(0, 0.12, 0.95);
    houseGrp.add(step);
  }

  // Sconces — out front they flank the entry door and the garage
  for (const [sx, sy] of front ? [[-5.4, 7.4], [1, 7.4], [-21, 7.5]] : [[-5.7, 7.4], [5.7, 7.4], [-21, 7.5], [15, 7.5]]) {
    const sc = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.1, 0.28), darkTrimMat);
    sc.position.set(sx, sy, 0.3);
    houseGrp.add(sc);
    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.18, 0.18),
      new THREE.MeshStandardMaterial({ color: 0xffe8bd, emissive: 0xffc873, emissiveIntensity: 1.2 }),
    );
    glow.position.set(sx, sy - 0.65, 0.3);
    houseGrp.add(glow);
  }

  // Vegetation
  const shrubGeos = [
    organic(new THREE.SphereGeometry(1, 16, 12), 0.16, 1),
    organic(new THREE.SphereGeometry(1, 16, 12), 0.2, 5),
    organic(new THREE.SphereGeometry(1, 16, 12), 0.24, 9),
  ];
  // Planting that hugs the facade — grouped so a product bolted to the wall
  // (attached carport) can clear the bed it lands in instead of growing a
  // shrub through a parked car.
  const dressing = new THREE.Group();
  houseGrp.add(dressing);
  const planterMat = new THREE.MeshStandardMaterial({ color: 0xe9e6dd, roughness: 0.8 });
  // Out front the right-hand bed would sit in the garage doorway / driveway
  for (const px of front ? [-6.8] : [-6.8, 6.8]) {
    const planter = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, 2.2), planterMat);
    planter.position.set(px, 0.75, 1.8);
    dressing.add(planter);
    const shrub = new THREE.Mesh(shrubGeos[px > 0 ? 1 : 2], leafMatA);
    shrub.scale.set(1.2, 1.05, 1.2);
    shrub.position.set(px, 2.25, 1.8);
    shrub.castShadow = true;
    dressing.add(shrub);
  }
  (front
    ? [[-16.5, 1.0], [-19, 1.15], [-21.5, 1.0], [21.5, 1.0], [23.5, 0.85]]
    : [[-16.5, 1.0], [-19, 1.15], [-21.5, 1.0], [16.5, 1.0], [19, 1.15], [21.5, 1.0]]
  ).forEach(([bx, br], i) => {
    const b = new THREE.Mesh(shrubGeos[i % 3], i % 2 ? leafMatB : leafMatA);
    b.scale.set(br * 1.25, br * 0.85, br * 1.25);
    b.position.set(bx, br * 0.62, 1.5);
    b.castShadow = true;
    dressing.add(b);
  });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.85, 9, 10), trunkMat);
  trunk.position.set(-38, 4.5, 10);
  trunk.castShadow = true;
  houseGrp.add(trunk);
  [[-38, 11, 10, 5.2], [-34.8, 9.4, 10.9, 3.6], [-41.2, 9.6, 9.2, 3.4], [-37.4, 8.8, 12.6, 3.0], [-38.6, 8.9, 7.6, 3.1]].forEach(([fx, fy, fz, fs], i) => {
    const leaf = new THREE.Mesh(shrubGeos[i % 3], i % 2 ? leafMatB : leafMatA);
    leaf.scale.set(fs, fs * 0.92, fs);
    leaf.position.set(fx, fy, fz);
    leaf.castShadow = true;
    houseGrp.add(leaf);
  });

  scene.add(houseGrp);

  // Fixed patio + furniture off the sliding door
  let patio = null, furniture = null;
  // Driveway: apron off the garage, doglegging into a run out to the property
  // line — where the gate tool stands its gate.
  if (front) {
    concreteTex.repeat.set(4, 5);
    // The two slabs BUTT at z = 12.5 — overlapping them would z-fight the tops
    for (const [w, d, cx, cz] of [[18, 13, 10, 6], [14, YARD.z1 - 12.5, 0, (YARD.z1 + 12.5) / 2]]) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), concreteMat);
      slab.position.set(cx, -0.12, cz);
      slab.receiveShadow = true;
      scene.add(slab);
    }
  }
  if (patioOpt) {
    const { w, d } = patioOpt;
    concreteTex.repeat.set(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(d / 4)));
    patio = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), concreteMat);
    patio.position.set(0, -0.12, d / 2 - 0.5);
    patio.receiveShadow = true;
    scene.add(patio);

    if (opts.furniture !== false) {
      const setG = new THREE.Group();
      const metalMat = new THREE.MeshStandardMaterial({ color: 0x1d1d1c, roughness: 0.5, metalness: 0.6 });
      const teakMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4c, roughness: 0.7 });
      const rug = new THREE.Mesh(
        new THREE.CylinderGeometry(4.1, 4.1, 0.05, 28),
        new THREE.MeshStandardMaterial({ color: 0xb7aea0, roughness: 1 }),
      );
      rug.position.y = 0.03;
      rug.receiveShadow = true;
      setG.add(rug);
      const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.12, 24), teakMat);
      tableTop.position.y = 2.45;
      tableTop.castShadow = true;
      setG.add(tableTop);
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 2.4, 10), metalMat);
      pedestal.position.y = 1.2;
      setG.add(pedestal);
      const tableBase = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 0.08, 16), metalMat);
      tableBase.position.y = 0.06;
      setG.add(tableBase);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        const ch = new THREE.Group();
        const seat = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 1.4), teakMat);
        seat.position.y = 1.45;
        ch.add(seat);
        const back = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 0.1), metalMat);
        back.position.set(0, 2.2, 0.68);
        ch.add(back);
        for (const lx of [-0.66, 0.66]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.45, 1.3), metalMat);
          leg.position.set(lx, 0.72, 0);
          ch.add(leg);
        }
        ch.position.set(Math.sin(a) * 3.3, 0, Math.cos(a) * 3.3);
        ch.rotation.y = a;
        ch.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        setG.add(ch);
      }
      setG.position.set(0, 0, d / 2 - 0.5);
      scene.add(setG);
      furniture = setG;
    }
  }

  return { houseGrp, dressing, patio, furniture };
}
