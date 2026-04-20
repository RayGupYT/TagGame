// --- Scene Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 50, 90);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(15, 30, 15);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.left = -30;
dirLight.shadow.camera.right = 30;
dirLight.shadow.camera.top = 30;
dirLight.shadow.camera.bottom = -30;
scene.add(dirLight);

// --- Day/Night Cycle ---
// 2 min day + 1 min night = 3 min (180s) full cycle
const DAY_DURATION = 120; // seconds
const NIGHT_DURATION = 60;
const CYCLE_DURATION = DAY_DURATION + NIGHT_DURATION;

const daySky = new THREE.Color(0x87ceeb);
const sunsetSky = new THREE.Color(0xff7744);
const nightSky = new THREE.Color(0x0a0a2a);
const dayFog = new THREE.Color(0x87ceeb);
const nightFog = new THREE.Color(0x0a0a2a);
const skyColor = new THREE.Color();
const fogColor = new THREE.Color();

function updateDayNight() {
  const t = (Date.now() / 1000) % CYCLE_DURATION;
  const transition = 10; // seconds for transitions

  let sunIntensity, ambIntensity, progress;

  if (t < DAY_DURATION - transition) {
    // Full day
    sunIntensity = 0.8;
    ambIntensity = 0.5;
    skyColor.copy(daySky);
    fogColor.copy(dayFog);
  } else if (t < DAY_DURATION) {
    // Day -> night transition
    progress = (t - (DAY_DURATION - transition)) / transition;
    sunIntensity = 0.8 * (1 - progress);
    ambIntensity = 0.5 - 0.35 * progress;
    skyColor.copy(daySky).lerp(sunsetSky, Math.min(progress * 2, 1));
    if (progress > 0.5) skyColor.lerp(nightSky, (progress - 0.5) * 2);
    fogColor.copy(dayFog).lerp(nightFog, progress);
  } else if (t < DAY_DURATION + NIGHT_DURATION - transition) {
    // Full night
    sunIntensity = 0;
    ambIntensity = 0.15;
    skyColor.copy(nightSky);
    fogColor.copy(nightFog);
  } else {
    // Night -> day transition
    progress = (t - (DAY_DURATION + NIGHT_DURATION - transition)) / transition;
    sunIntensity = 0.8 * progress;
    ambIntensity = 0.15 + 0.35 * progress;
    skyColor.copy(nightSky).lerp(sunsetSky, Math.min(progress * 2, 1));
    if (progress > 0.5) skyColor.lerp(daySky, (progress - 0.5) * 2);
    fogColor.copy(nightFog).lerp(dayFog, progress);
  }

  dirLight.intensity = sunIntensity;
  ambientLight.intensity = ambIntensity;
  scene.background.copy(skyColor);
  scene.fog.color.copy(fogColor);
}

// --- Ground ---
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(50, 50),
  new THREE.MeshStandardMaterial({ color: 0x4a8c3f })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// --- Colliders ---
const colliders = [];

// Block: bottom-center at (px, py, pz), dimensions sx x sy x sz
function addBlock(px, py, pz, sx, sy, sz, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    new THREE.MeshStandardMaterial({ color })
  );
  mesh.position.set(px, py + sy / 2, pz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  colliders.push({
    type: 'box',
    min: { x: px - sx / 2, z: pz - sz / 2 },
    max: { x: px + sx / 2, z: pz + sz / 2 },
    top: py + sy, bottom: py
  });
}

// Ramp wedge: bottom-center at (px, py, pz), footprint sx x sz, rises sy.
// rampDir = direction the slope goes UP:
//   '+x' → low at min-x, high at max-x
//   '-x' → low at max-x, high at min-x
//   '+z' → low at min-z, high at max-z
//   '-z' → low at max-z, high at min-z
function addRamp(px, py, pz, sx, sy, sz, rampDir, color) {
  const hx = sx / 2, hz = sz / 2;
  let verts, idx;
  // v0(-hx,0,-hz) v1(hx,0,-hz) v2(hx,0,hz) v3(-hx,0,hz) are bottom corners
  // v4,v5 are the raised edge
  if (rampDir === '+x') {
    // high edge at +x
    verts = [-hx,0,-hz, hx,0,-hz, hx,0,hz, -hx,0,hz, hx,sy,-hz, hx,sy,hz];
    idx = [0,2,1,0,3,2, 0,1,4,0,4,3, 3,4,5,3,5,2, 0,4,3, 1,2,5, 4,5,2]; // bottom, slope, back, left-tri, right-tri
  } else if (rampDir === '-x') {
    // high edge at -x
    verts = [-hx,0,-hz, hx,0,-hz, hx,0,hz, -hx,0,hz, -hx,sy,-hz, -hx,sy,hz];
    idx = [0,2,1,0,3,2, 1,2,5,1,5,4, 0,4,5,0,5,3, 0,1,4, 2,3,5];
  } else if (rampDir === '+z') {
    // high edge at +z
    verts = [-hx,0,-hz, hx,0,-hz, hx,0,hz, -hx,0,hz, -hx,sy,hz, hx,sy,hz];
    idx = [0,2,1,0,3,2, 0,1,5,0,5,4, 3,4,5,3,5,2, 0,4,3, 1,2,5];
    // fix: slope face, back face, sides
  } else { // '-z'
    // high edge at -z
    verts = [-hx,0,-hz, hx,0,-hz, hx,0,hz, -hx,0,hz, -hx,sy,-hz, hx,sy,-hz];
    idx = [0,2,1,0,3,2, 2,3,4,2,4,5, 0,5,4,0,1,5, 0,4,3, 1,2,5];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide }));
  mesh.position.set(px, py, pz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  colliders.push({
    type: 'ramp', rampDir,
    min: { x: px - hx, z: pz - hz },
    max: { x: px + hx, z: pz + hz },
    lowY: py, highY: py + sy
  });
}

// Tunnel helper: two walls + roof, runs along axis
function addTunnel(px, py, pz, length, width, height, axis, wallColor, roofColor) {
  const wt = 0.4, rt = 0.3;
  if (axis === 'z') {
    addBlock(px - width/2 - wt/2, py, pz, wt, height, length, wallColor);
    addBlock(px + width/2 + wt/2, py, pz, wt, height, length, wallColor);
    addBlock(px, py + height, pz, width + wt*2, rt, length, roofColor);
  } else {
    addBlock(px, py, pz - width/2 - wt/2, length, height, wt, wallColor);
    addBlock(px, py, pz + width/2 + wt/2, length, height, wt, wallColor);
    addBlock(px, py + height, pz, length, rt, width + wt*2, roofColor);
  }
}

// ==============================================
// BOUNDARY WALLS (stone perimeter)
// ==============================================
addBlock(0, 0, -25, 50, 15, 0.5, 0x6B6B6B);
addBlock(0, 0,  25, 50, 15, 0.5, 0x6B6B6B);
addBlock(-25, 0, 0, 0.5, 15, 50, 0x6B6B6B);
addBlock( 25, 0, 0, 0.5, 15, 50, 0x6B6B6B);

// ==============================================
// CENTER PLAZA — open area with a raised stone platform
// ==============================================
addBlock(0, 0, 0, 6, 1.5, 6, 0x8B8B83);          // center platform
addRamp(0, 0, 4.5, 6, 1.5, 3, '-z', 0x9C9C8E);  // south ramp
addRamp(0, 0, -4.5, 6, 1.5, 3, '+z', 0x9C9C8E); // north ramp
addRamp(-4.5, 0, 0, 3, 1.5, 6, '+x', 0x9C9C8E); // west ramp
addRamp(4.5, 0, 0, 3, 1.5, 6, '-x', 0x9C9C8E);  // east ramp

// ==============================================
// NORTH AREA — tiered wooden platforms
// ==============================================
addBlock(0, 0, -10, 8, 2, 5, 0x8B6914);           // big platform
addRamp(0, 0, -6.5, 6, 2, 2, '+z', 0xA08060);    // ramp down south
addBlock(-6, 0, -12, 3, 3, 3, 0x7A5B3A);          // tall block
addRamp(-6, 0, -9.5, 3, 3, 2, '+z', 0xA08060);   // ramp down
addBlock(7, 0, -11, 4, 1.5, 4, 0x8B6914);         // side platform
addRamp(7, 0, -14, 4, 1.5, 2, '+z', 0xA08060);

// ==============================================
// NORTHEAST — parkour blocks + lookout tower
// ==============================================
addBlock(16, 0, -16, 3, 1, 3, 0xA0522D);
addBlock(19, 0, -18, 2, 2, 2, 0x8B6914);
addBlock(22, 0, -16, 3, 3, 3, 0xA0522D);          // tall lookout
addRamp(22, 0, -13, 3, 3, 3, '+z', 0x9C9C8E);    // ramp up to lookout
addBlock(16, 0, -21, 3, 1.5, 3, 0x7A5B3A);
addBlock(12, 0, -19, 2.5, 2.5, 2.5, 0x8B6914);

// ==============================================
// EAST CORRIDOR — long covered passage
// ==============================================
addTunnel(18, 0, -4, 8, 3, 3, 'z', 0x7A6B5D, 0x6B5B4F);
addBlock(14, 0, -3, 2, 2, 2, 0xA0522D);           // crate at entrance
addBlock(14, 0, 3, 2, 1.5, 2, 0x8B6914);

// ==============================================
// SOUTHEAST — stacked platforms + ramps
// ==============================================
addBlock(16, 0, 10, 6, 1.5, 5, 0x8B8B83);         // base
addRamp(16, 0, 14, 5, 1.5, 3, '-z', 0x9C9C8E);   // ramp south
addBlock(20, 1.5, 10, 3, 1.5, 3, 0x7A5B3A);       // upper tier
addRamp(20, 0, 7, 3, 1.5, 3, '+z', 0x9C9C8E);    // ground ramp east
addBlock(14, 0, 18, 3, 2, 3, 0xA0522D);
addBlock(18, 0, 20, 2.5, 1, 2.5, 0x8B6914);
addBlock(22, 0, 18, 3, 2.5, 3, 0x7A5B3A);
addRamp(22, 0, 15, 3, 2.5, 3, '+z', 0x9C9C8E);

// ==============================================
// SOUTH — wide bridge over tunnel
// ==============================================
addTunnel(0, 0, 14, 12, 3.5, 3, 'x', 0x6B5B4F, 0x5C5C5C);
addBlock(-8, 0, 18, 4, 2, 4, 0x8B8B83);
addRamp(-8, 0, 15, 4, 2, 2, '+z', 0x9C9C8E);
addBlock(8, 0, 19, 3, 1.5, 3, 0x8B6914);
addBlock(4, 0, 21, 2, 2.5, 2, 0xA0522D);

// ==============================================
// SOUTHWEST — hideout compound
// ==============================================
addBlock(-16, 0, 16, 6, 2, 6, 0x7A5B3A);          // raised floor
addRamp(-12, 0, 16, 3, 2, 5, '-x', 0xA08060);    // east ramp up
addBlock(-16, 2, 19.3, 6, 2, 0.4, 0x5C5C5C);     // south wall
addBlock(-19.3, 2, 16, 0.4, 2, 6, 0x5C5C5C);     // west wall
addBlock(-16, 2, 12.7, 6, 2, 0.4, 0x5C5C5C);     // north wall
addBlock(-17, 2, 16, 1.5, 1, 1.5, 0xA0522D);     // cover inside
addBlock(-22, 0, 12, 2, 1.5, 2, 0x8B6914);
addBlock(-22, 0, 22, 3, 2, 3, 0x7A5B3A);

// ==============================================
// WEST — scattered cover + elevated walkway
// ==============================================
addBlock(-15, 0, 0, 4, 2.5, 3, 0x8B8B83);         // stone platform
addRamp(-15, 0, -3, 4, 2.5, 3, '+z', 0x9C9C8E);  // ramp north
addRamp(-15, 0, 3, 4, 2.5, 3, '-z', 0x9C9C8E);   // ramp south
addBlock(-22, 0, -3, 3, 1.5, 3, 0x8B6914);
addBlock(-22, 0, 3, 2, 2, 2, 0xA0522D);
addBlock(-18, 0, 6, 2, 1, 2, 0x7A5B3A);

// ==============================================
// NORTHWEST — enclosed room + approach
// ==============================================
addBlock(-16, 0, -18, 6, 3, 0.4, 0x5C5C5C);       // north wall
addBlock(-16, 0, -13, 6, 3, 0.4, 0x5C5C5C);       // south wall split
addBlock(-19.3, 0, -15.5, 0.4, 3, 5, 0x5C5C5C);   // west wall
addBlock(-12.7, 0, -15.5, 0.4, 3, 5, 0x5C5C5C);   // east wall
addBlock(-16, 3, -15.5, 7, 0.3, 5.4, 0x4A4A4A);   // roof
addBlock(-17, 0, -16.5, 1.5, 1.5, 1.5, 0xA0522D); // crate inside
addBlock(-22, 0, -14, 2, 2.5, 2, 0x7A5B3A);       // approach block
addBlock(-10, 0, -16, 2, 1.5, 2, 0x8B6914);

// ==============================================
// WEST TUNNEL connecting NW to SW
// ==============================================
addTunnel(-22, 0, 6, 8, 2.5, 3, 'z', 0x6B5B4F, 0x5C5C5C);

// ==============================================
// NORTH TUNNEL connecting center to north
// ==============================================
addTunnel(8, 0, -6, 6, 3, 3, 'z', 0x6B5B4F, 0x5C5C5C);

// ==============================================
// SCATTERED OUTDOOR COVER — wooden crates & stone blocks
// ==============================================
addBlock(-5, 0, 7, 2, 1.5, 2, 0xA0522D);
addBlock(5, 0, -5, 1.5, 2, 1.5, 0x8B6914);
addBlock(-3, 0, -7, 2, 1, 2, 0x7A5B3A);
addBlock(10, 0, 3, 1.5, 2.5, 1.5, 0xA0522D);
addBlock(-10, 0, 8, 2, 1.5, 2, 0x8B6914);
addBlock(6, 0, 18, 2, 2, 2, 0x7A5B3A);
addBlock(-6, 0, 22, 2, 1.5, 2, 0xA0522D);
addBlock(10, 0, -14, 2, 1, 2, 0x8B6914);
addBlock(-10, 0, -22, 2, 2, 2, 0x7A5B3A);
addBlock(3, 0, -18, 1.5, 1.5, 1.5, 0xA0522D);
addBlock(12, 0, 22, 2, 1.5, 2, 0x8B6914);
addBlock(-3, 0, 10, 1.5, 2, 1, 0x7A5B3A);

// ==============================================
// TELEPORTER PADS — glowing pads at corners
// ==============================================
const teleporterPads = [];
const TELE_POSITIONS = [
  { x: -20, z: -20 }, { x: 20, z: -20 },
  { x: -20, z: 20 },  { x: 20, z: 20 },
];
TELE_POSITIONS.forEach(pos => {
  const padGroup = new THREE.Group();

  // Base platform
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.5, 0.2, 24),
    new THREE.MeshStandardMaterial({ color: 0x222244 })
  );
  base.position.y = 0.1;
  base.receiveShadow = true;
  padGroup.add(base);

  // Inner glowing ring
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.1, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0x8844ff })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.25;
  padGroup.add(ring);

  // Outer ring
  const ring2 = new THREE.Mesh(
    new THREE.TorusGeometry(1.4, 0.05, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0xaa66ff })
  );
  ring2.rotation.x = Math.PI / 2;
  ring2.position.y = 0.25;
  padGroup.add(ring2);

  // Floating particles (vertical column)
  for (let i = 0; i < 8; i++) {
    const particle = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xcc88ff })
    );
    particle.position.y = 0.5 + i * 0.4;
    particle.userData.baseY = particle.position.y;
    particle.userData.phase = Math.random() * Math.PI * 2;
    padGroup.add(particle);
  }

  // Label
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 48;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#aa66ff';
  ctx.font = 'bold 22px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('TELEPORT', 64, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  label.position.y = 4;
  label.scale.set(2, 0.75, 1);
  padGroup.add(label);

  padGroup.position.set(pos.x, 0, pos.z);
  scene.add(padGroup);
  teleporterPads.push(padGroup);
});

function updateTeleporterPads() {
  const t = Date.now() * 0.002;
  teleporterPads.forEach((pad, i) => {
    // Spin rings
    pad.children[1].rotation.z = t + i;
    pad.children[2].rotation.z = -t * 0.7 + i;
    // Animate particles
    for (let j = 3; j < 3 + 8; j++) {
      const p = pad.children[j];
      if (!p || !p.userData.baseY) continue;
      p.position.y = p.userData.baseY + Math.sin(t * 2 + p.userData.phase) * 0.2;
      const angle = t * 3 + p.userData.phase;
      p.position.x = Math.cos(angle) * 0.4;
      p.position.z = Math.sin(angle) * 0.4;
    }
  });
}

// ==============================================
// PLAYER
// ==============================================
const playerPos = new THREE.Vector3(
  (Math.random() - 0.5) * 20,
  0,
  (Math.random() - 0.5) * 20
);
const PLAYER_RADIUS = 0.4;
const PLAYER_EYE_HEIGHT = 1.7;
const CROUCH_EYE_HEIGHT = 1.0;
const PLAYER_HEIGHT = 1.9;
const CROUCH_HEIGHT = 1.2;
const SPEED = 8;
const TAGGER_SPEED = 8.8; // ~10% faster
const CROUCH_SPEED_MULT = 0.5;
const GRAVITY = 25;
const JUMP_FORCE = 9;
let velocityY = 0;
let onGround = true;
let crouching = false;
let yaw = 0, pitch = 0;
let myId = null;
let iAmTagger = false;
let gameStarted = false;

// --- Collision ---
function getSurfaceY(c, x, z) {
  if (c.type === 'box') return c.top;
  const dx = c.max.x - c.min.x, dz = c.max.z - c.min.z;
  let t = 0;
  if (c.rampDir === '+x') t = (x - c.min.x) / dx;
  else if (c.rampDir === '-x') t = (c.max.x - x) / dx;
  else if (c.rampDir === '+z') t = (z - c.min.z) / dz;
  else if (c.rampDir === '-z') t = (c.max.z - z) / dz;
  return c.lowY + Math.max(0, Math.min(1, t)) * (c.highY - c.lowY);
}

function overlapsXZ(x, z, c) {
  return x + PLAYER_RADIUS > c.min.x && x - PLAYER_RADIUS < c.max.x &&
         z + PLAYER_RADIUS > c.min.z && z - PLAYER_RADIUS < c.max.z;
}

function getFloorY(x, z, footY) {
  let floor = 0;
  for (const c of colliders) {
    if (!overlapsXZ(x, z, c)) continue;
    const s = getSurfaceY(c, x, z);
    if (s <= footY + 0.5 && s > floor) floor = s;
  }
  return floor;
}

function collidesAt(x, z, footY) {
  for (const c of colliders) {
    if (!overlapsXZ(x, z, c)) continue;
    const s = getSurfaceY(c, x, z);
    const bot = c.type === 'box' ? c.bottom : c.lowY;
    if (s > footY + 0.5 && bot < footY + PLAYER_HEIGHT) return true;
  }
  return false;
}

// ==============================================
// MULTIPLAYER — other player models
// ==============================================
const otherPlayers = new Map(); // id -> { group, nameSprite, lastData }

function createPlayerModel(username, isTagger) {
  const group = new THREE.Group();

  const bodyColor = isTagger ? 0xff2222 : 0x2266cc;

  // Body
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 1.2, 0.5),
    new THREE.MeshStandardMaterial({ color: bodyColor })
  );
  body.position.y = 1.4;
  body.castShadow = true;
  group.add(body);

  // Head
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 16, 16),
    new THREE.MeshStandardMaterial({ color: isTagger ? 0xff6666 : 0xffcc99 })
  );
  head.position.y = 2.35;
  head.castShadow = true;
  group.add(head);

  // Eyes
  const eyeGeo = new THREE.SphereGeometry(0.06, 8, 8);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const le = new THREE.Mesh(eyeGeo, eyeMat);
  le.position.set(-0.12, 2.4, 0.3);
  group.add(le);
  const re = new THREE.Mesh(eyeGeo, eyeMat);
  re.position.set(0.12, 2.4, 0.3);
  group.add(re);

  // Arms
  const armMat = new THREE.MeshStandardMaterial({ color: bodyColor });
  const la = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, 0.25), armMat);
  la.position.set(-0.55, 1.3, 0);
  la.castShadow = true;
  group.add(la);
  const ra = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, 0.25), armMat);
  ra.position.set(0.55, 1.3, 0);
  ra.castShadow = true;
  group.add(ra);

  // Legs
  const legMat = new THREE.MeshStandardMaterial({ color: isTagger ? 0x991111 : 0x333366 });
  const ll = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 0.3), legMat);
  ll.position.set(-0.2, 0.4, 0);
  ll.castShadow = true;
  group.add(ll);
  const rl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 0.3), legMat);
  rl.position.set(0.2, 0.4, 0);
  rl.castShadow = true;
  group.add(rl);

  // Tagger glow ring
  if (isTagger) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.08, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0xff0000 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.1;
    group.add(ring);
  }

  // Floating name tag
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = isTagger ? '#ff2222' : '#ffffff';
  ctx.font = 'bold 28px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(isTagger ? `[IT] ${username}` : username, 128, 40);
  const tex = new THREE.CanvasTexture(canvas);
  const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.position.y = 3.2;
  sprite.scale.set(2.5, 0.6, 1);
  group.add(sprite);

  return group;
}

// Store target positions from server, interpolate every frame
function updateOtherPlayers(playerList) {
  const seen = new Set();
  for (const p of playerList) {
    if (p.id === myId) continue;
    seen.add(p.id);

    let entry = otherPlayers.get(p.id);
    if (!entry || entry.wasTagger !== p.isTagger) {
      if (entry) scene.remove(entry.group);
      const group = createPlayerModel(p.username, p.isTagger);
      scene.add(group);
      entry = { group, wasTagger: p.isTagger, tx: p.x, ty: p.y, tz: p.z, tyaw: p.yaw };
      group.position.set(p.x, p.y, p.z);
      group.rotation.y = p.yaw;
      otherPlayers.set(p.id, entry);
    }

    // Update targets (actual server position)
    entry.tx = p.x;
    entry.ty = p.y;
    entry.tz = p.z;
    entry.tyaw = p.yaw;
  }

  // Remove disconnected players
  for (const [id, entry] of otherPlayers) {
    if (!seen.has(id)) {
      scene.remove(entry.group);
      otherPlayers.delete(id);
    }
  }
}

// Called every frame to smoothly interpolate other player positions
function interpolateOtherPlayers() {
  const lerpFactor = 0.15; // smooth per-frame lerp
  for (const entry of otherPlayers.values()) {
    const g = entry.group;
    const prevX = g.position.x;
    const prevZ = g.position.z;

    g.position.x += (entry.tx - g.position.x) * lerpFactor;
    g.position.y += (entry.ty - g.position.y) * lerpFactor;
    g.position.z += (entry.tz - g.position.z) * lerpFactor;

    // Smooth yaw interpolation (handle wraparound)
    let dyaw = entry.tyaw - g.rotation.y;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    g.rotation.y += dyaw * lerpFactor;

    // Walk animation based on actual visual movement
    const dx = g.position.x - prevX;
    const dz = g.position.z - prevZ;
    const moving = Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001;
    if (moving) {
      const swing = Math.sin(Date.now() * 0.012) * 0.5;
      g.children[6].rotation.x = swing;
      g.children[7].rotation.x = -swing;
      g.children[4].rotation.x = -swing;
      g.children[5].rotation.x = swing;
    } else {
      // Smoothly return limbs to rest
      g.children[6].rotation.x *= 0.85;
      g.children[7].rotation.x *= 0.85;
      g.children[4].rotation.x *= 0.85;
      g.children[5].rotation.x *= 0.85;
    }
  }
}

// ==============================================
// EMOTES
// ==============================================
const activeEmotes = []; // { sprite, startTime, owner }
const EMOTE_DURATION = 2500; // ms
const EMOTE_COOLDOWN = 3000;
let lastEmoteTime = 0;

function createEmoteSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.roundRect(16, 8, 224, 112, 20);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 72px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 64);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2, 1, 1);
  return sprite;
}

function showEmote(playerId, emote) {
  const text = emote === '67' ? '67' : 'L';

  if (playerId === myId) {
    // Show above own position (floating in world)
    const sprite = createEmoteSprite(text);
    sprite.position.set(playerPos.x, playerPos.y + 3, playerPos.z);
    scene.add(sprite);
    activeEmotes.push({ sprite, startTime: Date.now(), owner: 'self' });
  } else {
    const entry = otherPlayers.get(playerId);
    if (entry) {
      const sprite = createEmoteSprite(text);
      sprite.position.y = 4;
      entry.group.add(sprite);
      activeEmotes.push({ sprite, startTime: Date.now(), owner: entry.group });
    }
  }
}

function updateEmotes() {
  const now = Date.now();
  for (let i = activeEmotes.length - 1; i >= 0; i--) {
    const e = activeEmotes[i];
    const elapsed = now - e.startTime;

    if (elapsed > EMOTE_DURATION) {
      if (e.owner === 'self') {
        scene.remove(e.sprite);
      } else {
        e.owner.remove(e.sprite);
      }
      e.sprite.material.dispose();
      activeEmotes.splice(i, 1);
      continue;
    }

    // Float up slowly + fade out near end
    if (e.owner === 'self') {
      e.sprite.position.set(playerPos.x, playerPos.y + 3 + elapsed * 0.0005, playerPos.z);
    } else {
      e.sprite.position.y = 4 + elapsed * 0.0005;
    }
    if (elapsed > EMOTE_DURATION * 0.7) {
      e.sprite.material.opacity = 1 - (elapsed - EMOTE_DURATION * 0.7) / (EMOTE_DURATION * 0.3);
    }
  }
}

// ==============================================
// POWERUPS
// ==============================================
const activePowerups = new Map(); // id -> { mesh, type, x, z }
const BOOST_DURATION = 3000;
let speedBoostEnd = 0;
let jumpBoostEnd = 0;

function createPowerupMesh(type, x, z) {
  const group = new THREE.Group();

  // Floating orb
  const color = type === 'speed' ? 0x00ccff : 0x44ff44;
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 16, 16),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, transparent: true, opacity: 0.8 })
  );
  orb.position.y = 1.5;
  group.add(orb);

  // Ring around it
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.7, 0.06, 8, 24),
    new THREE.MeshBasicMaterial({ color })
  );
  ring.position.y = 1.5;
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  // Label
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = type === 'speed' ? '#00ccff' : '#44ff44';
  ctx.font = 'bold 24px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(type === 'speed' ? 'SPEED' : 'JUMP', 64, 40);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.position.y = 2.5;
  sprite.scale.set(1.5, 0.75, 1);
  group.add(sprite);

  group.position.set(x, 0, z);
  scene.add(group);
  return group;
}

function updatePowerups() {
  const t = Date.now() * 0.003;
  for (const pu of activePowerups.values()) {
    // Bob up and down + spin
    pu.mesh.children[0].position.y = 1.5 + Math.sin(t + pu.x) * 0.3;
    pu.mesh.children[1].position.y = 1.5 + Math.sin(t + pu.x) * 0.3;
    pu.mesh.children[1].rotation.z += 0.02;
  }
}

function sendEmote(emote) {
  const now = Date.now();
  if (now - lastEmoteTime < EMOTE_COOLDOWN) return;
  lastEmoteTime = now;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'emote', emote }));
  }
}

// ==============================================
// UI ELEMENTS
// ==============================================
const banner = document.getElementById('tagger-banner');
const chatLog = document.getElementById('chat-log');
const playerCount = document.getElementById('player-count');
const roundTimer = document.getElementById('round-timer');
const phaseOverlay = document.getElementById('phase-overlay');
const phaseText = phaseOverlay.querySelector('.phase-text');
const phaseSub = phaseOverlay.querySelector('.phase-sub');
let currentPhase = 'lobby';
let phaseOverlayTimeout = null;

function addChat(text) {
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  while (chatLog.children.length > 20) chatLog.removeChild(chatLog.firstChild);
}

function addPlayerChat(username, text) {
  const div = document.createElement('div');
  div.className = 'chat-msg';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'chat-name';
  nameSpan.textContent = username + ':';
  div.appendChild(nameSpan);
  div.appendChild(document.createTextNode(' ' + text));
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  while (chatLog.children.length > 20) chatLog.removeChild(chatLog.firstChild);
}

function formatTime(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function teleportPlayer(x, y, z) {
  playerPos.set(x, y, z);
  velocityY = 0;
  onGround = true;
  crouching = false;
}

function showPhaseOverlay(main, sub, duration) {
  phaseText.textContent = main;
  phaseSub.textContent = sub;
  phaseOverlay.style.display = 'flex';
  if (phaseOverlayTimeout) clearTimeout(phaseOverlayTimeout);
  phaseOverlayTimeout = setTimeout(() => {
    phaseOverlay.style.display = 'none';
  }, duration);
}

const leaderboardEl = document.getElementById('leaderboard');
let leaderboardTimeout = null;

function formatTimeSec(ms) {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `${min}:${s.toString().padStart(2, '0')}`;
}

function showLeaderboard(leaderboard, winner) {
  let html = `<div class="lb-winner-label">${winner} WINS!</div>`;
  html += '<h2>LEADERBOARD</h2>';
  leaderboard.forEach((entry, i) => {
    const isWinner = i === 0 ? ' winner' : '';
    const medal = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i+1}th`;
    html += `<div class="lb-row${isWinner}">
      <span class="lb-rank">${medal}</span>
      <span class="lb-name">${entry.username}</span>
      <span class="lb-time">${formatTimeSec(entry.taggerTimeMs)} as IT</span>
    </div>`;
  });
  leaderboardEl.innerHTML = html;
  leaderboardEl.style.display = 'block';
  if (leaderboardTimeout) clearTimeout(leaderboardTimeout);
  leaderboardTimeout = setTimeout(() => {
    leaderboardEl.style.display = 'none';
  }, 8000);
}

// Crosshair
const crosshair = document.createElement('div');
crosshair.style.cssText = 'position:fixed;top:50%;left:50%;width:6px;height:6px;background:white;border:1px solid black;border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:10;display:none;';
document.body.appendChild(crosshair);

// ==============================================
// NETWORKING
// ==============================================
let ws;

function connectWS(username) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', username }));
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);

    if (msg.type === 'welcome') {
      myId = msg.id;
      teleportPlayer(msg.x, msg.y, msg.z);
      currentPhase = msg.gamePhase;
      if (currentPhase === 'lobby') {
        showPhaseOverlay('LOBBY', 'Waiting for round to start...', 3000);
      }
    }

    if (msg.type === 'state') {
      updateOtherPlayers(msg.players);
      currentPhase = msg.gamePhase;
      iAmTagger = msg.taggerId === myId;

      // Update banner
      if (msg.gamePhase === 'playing') {
        const tagger = msg.players.find(p => p.isTagger);
        if (tagger) {
          banner.style.display = 'block';
          if (iAmTagger) {
            banner.className = 'is-tagger';
            banner.textContent = 'YOU ARE IT! Tag someone!';
          } else {
            banner.className = 'not-tagger';
            banner.textContent = `${tagger.username} is IT — RUN!`;
          }
        }
        // Round timer
        roundTimer.style.display = 'block';
        roundTimer.textContent = `⏱ ${formatTime(msg.timeLeft)}`;
      } else {
        // Lobby
        banner.style.display = 'block';
        banner.className = 'not-tagger';
        banner.textContent = `LOBBY — Next round in ${formatTime(msg.timeLeft)}`;
        roundTimer.style.display = 'none';
      }

      playerCount.textContent = `Players: ${msg.players.length}`;
    }

    if (msg.type === 'roundStart') {
      // Teleport to assigned spawn
      const mySpawn = msg.teleports.find(t => t.id === myId);
      if (mySpawn) teleportPlayer(mySpawn.x, mySpawn.y, mySpawn.z);

      if (msg.taggerId === myId) {
        showPhaseOverlay('YOU ARE IT!', 'Chase and tag other players!', 3000);
      } else {
        showPhaseOverlay('ROUND START!', `${msg.taggerUsername} is the tagger — RUN!`, 3000);
      }
    }

    if (msg.type === 'roundEnd') {
      // Teleport to lobby
      const mySpawn = msg.teleports.find(t => t.id === myId);
      if (mySpawn) teleportPlayer(mySpawn.x, mySpawn.y, mySpawn.z);

      showPhaseOverlay('ROUND OVER!', `${msg.winner} wins!`, 6000);
      showLeaderboard(msg.leaderboard, msg.winner);
    }

    if (msg.type === 'tagged') {
      addChat(`${msg.taggerUsername} tagged ${msg.taggedUsername}!`);
    }

    if (msg.type === 'chat') {
      addChat(msg.text);
    }

    if (msg.type === 'playerChat') {
      addPlayerChat(msg.username, msg.text);
    }

    if (msg.type === 'emote') {
      showEmote(msg.id, msg.emote);
    }

    if (msg.type === 'powerupSpawn') {
      const pu = msg.powerup;
      const mesh = createPowerupMesh(pu.type, pu.x, pu.z);
      activePowerups.set(pu.id, { mesh, type: pu.type, x: pu.x, z: pu.z });
    }

    if (msg.type === 'powerupPickup') {
      const pu = activePowerups.get(msg.powerupId);
      if (pu) {
        scene.remove(pu.mesh);
        activePowerups.delete(msg.powerupId);
      }
      if (msg.playerId === myId) {
        if (msg.powerupType === 'speed') {
          speedBoostEnd = Date.now() + BOOST_DURATION;
          addChat('You picked up SPEED BOOST!');
        } else {
          jumpBoostEnd = Date.now() + BOOST_DURATION;
          addChat('You picked up JUMP BOOST!');
        }
      }
    }

    if (msg.type === 'teleport') {
      teleportPlayer(msg.x, msg.y, msg.z);
      addChat('Teleported!');
    }

    if (msg.type === 'powerupClearAll') {
      for (const pu of activePowerups.values()) scene.remove(pu.mesh);
      activePowerups.clear();
    }
  };

  ws.onclose = () => {
    addChat('Disconnected from server.');
    banner.style.display = 'block';
    banner.className = 'is-tagger';
    banner.textContent = 'DISCONNECTED — Refresh to rejoin';
  };
}

// ==============================================
// LOGIN
// ==============================================
const loginScreen = document.getElementById('login-screen');
const usernameInput = document.getElementById('username-input');
const playBtn = document.getElementById('play-btn');

function startGame() {
  const username = usernameInput.value.trim() || 'Player';
  loginScreen.style.display = 'none';
  crosshair.style.display = 'block';
  playerCount.style.display = 'block';
  gameStarted = true;
  renderer.domElement.requestPointerLock();
  connectWS(username);
}

playBtn.addEventListener('click', startGame);
usernameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') startGame();
});

// ==============================================
// INPUT
// ==============================================
renderer.domElement.addEventListener('click', () => {
  if (gameStarted) renderer.domElement.requestPointerLock();
});

document.addEventListener('mousemove', e => {
  if (!document.pointerLockElement || !gameStarted) return;
  yaw -= e.movementX * 0.002;
  pitch -= e.movementY * 0.002;
  pitch = Math.max(-Math.PI/2 + 0.01, Math.min(Math.PI/2 - 0.01, pitch));
});

const keys = {};
const chatInput = document.getElementById('chat-input');
const chatHint = document.getElementById('chat-hint');
let chatOpen = false;

window.addEventListener('keydown', e => {
  if (!gameStarted) return;

  // Toggle chat with T
  if (e.code === 'KeyT' && !chatOpen) {
    e.preventDefault();
    chatOpen = true;
    chatInput.style.display = 'block';
    chatHint.style.display = 'none';
    chatInput.focus();
    document.exitPointerLock();
    return;
  }

  // Don't process game keys while chatting
  if (chatOpen) return;

  if (e.code === 'KeyC' && !keys['KeyC']) crouching = !crouching;
  if (e.code === 'Digit1') sendEmote('67');
  if (e.code === 'Digit2') sendEmote('L');
  keys[e.code] = true;
});
window.addEventListener('keyup', e => { if (!chatOpen) keys[e.code] = false; });

chatInput.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    const text = chatInput.value.trim();
    if (text && ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'chatMsg', text }));
    }
    chatInput.value = '';
    chatInput.style.display = 'none';
    chatHint.style.display = 'block';
    chatOpen = false;
    renderer.domElement.requestPointerLock();
  }
  if (e.key === 'Escape') {
    chatInput.value = '';
    chatInput.style.display = 'none';
    chatHint.style.display = 'block';
    chatOpen = false;
    renderer.domElement.requestPointerLock();
  }
});

// ==============================================
// GAME LOOP
// ==============================================
let sendTimer = 0;

function animate() {
  requestAnimationFrame(animate);
  updateDayNight();
  if (!gameStarted) { renderer.render(scene, camera); return; }

  const dt = 1/60;
  let mx = 0, mz = 0;
  const sn = Math.sin(yaw), cn = Math.cos(yaw);

  if (keys['KeyW']||keys['ArrowUp'])    { mx -= sn; mz -= cn; }
  if (keys['KeyS']||keys['ArrowDown'])  { mx += sn; mz += cn; }
  if (keys['KeyA']||keys['ArrowLeft'])  { mx -= cn; mz += sn; }
  if (keys['KeyD']||keys['ArrowRight']) { mx += cn; mz -= sn; }

  const now = Date.now();
  const hasSpeedBoost = now < speedBoostEnd;
  const hasJumpBoost = now < jumpBoostEnd;

  let spd = iAmTagger ? TAGGER_SPEED : SPEED;
  if (hasSpeedBoost) spd *= 1.6;
  if (crouching) spd *= CROUCH_SPEED_MULT;
  const len = Math.sqrt(mx*mx + mz*mz);
  if (len > 0) { mx = mx/len*spd*dt; mz = mz/len*spd*dt; }

  if (keys['Space'] && onGround) {
    crouching = false;
    velocityY = hasJumpBoost ? JUMP_FORCE * 1.8 : JUMP_FORCE;
    onGround = false;
  }

  velocityY -= GRAVITY * dt;
  playerPos.y += velocityY * dt;

  const curHeight = crouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;
  const nx = playerPos.x + mx, nz = playerPos.z + mz;
  if (!collidesAt(nx, playerPos.z, playerPos.y)) playerPos.x = nx;
  if (!collidesAt(playerPos.x, nz, playerPos.y)) playerPos.z = nz;

  const fy = getFloorY(playerPos.x, playerPos.z, playerPos.y);
  if (playerPos.y <= fy) { playerPos.y = fy; velocityY = 0; onGround = true; }

  const eyeH = crouching ? CROUCH_EYE_HEIGHT : PLAYER_EYE_HEIGHT;
  camera.position.set(playerPos.x, playerPos.y + eyeH, playerPos.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;

  // Interpolate other players every frame for smooth motion
  interpolateOtherPlayers();
  updateEmotes();
  updatePowerups();
  updateTeleporterPads();

  // Send position to server ~15 times/sec
  sendTimer += dt;
  if (sendTimer > 1/15 && ws && ws.readyState === 1) {
    sendTimer = 0;
    ws.send(JSON.stringify({
      type: 'move',
      x: Math.round(playerPos.x * 100) / 100,
      y: Math.round(playerPos.y * 100) / 100,
      z: Math.round(playerPos.z * 100) / 100,
      yaw: Math.round(yaw * 100) / 100
    }));
  }

  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
