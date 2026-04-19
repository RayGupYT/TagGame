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
// BOUNDARY WALLS
// ==============================================
addBlock(0, 0, -25, 50, 15, 0.5, 0x888888);
addBlock(0, 0,  25, 50, 15, 0.5, 0x888888);
addBlock(-25, 0, 0, 0.5, 15, 50, 0x888888);
addBlock( 25, 0, 0, 0.5, 15, 50, 0x888888);

// ==============================================
// TUNNEL 1 — runs along X, north area
// center (0,0,-14), x[-5,5], walls at z~-15.7 and z~-12.3
// ==============================================
addTunnel(0, 0, -14, 10, 3, 3, 'x', 0x777777, 0x666666);

// ==============================================
// TUNNEL 2 — runs along Z, east side
// center (20,0,0), z[-6,6], walls at x~18.3 and x~21.7
// ==============================================
addTunnel(20, 0, 0, 12, 3, 3, 'z', 0x777777, 0x666666);

// ==============================================
// TUNNEL 3 — runs along X, south area
// center (0,0,16), x[-5,5], walls at z~14.3 and z~17.7
// ==============================================
addTunnel(0, 0, 16, 10, 3, 3, 'x', 0x777777, 0x666666);

// ==============================================
// TUNNEL 4 — runs along Z, west side
// center (-20,0,-6), z[-11,-1], walls at x~-21.7 and x~-18.3
// ==============================================
addTunnel(-20, 0, -6, 10, 3, 3, 'z', 0x777777, 0x666666);

// ==============================================
// BRIDGE 1 — northeast, spans along X
// Deck at y=3, x[4,16] z[-8.25,-5.75]
// Ramps flush on both ends
// ==============================================
addBlock(7,  0, -7, 1.2, 3, 1.2, 0x5C5C5C);    // pillar
addBlock(13, 0, -7, 1.2, 3, 1.2, 0x5C5C5C);    // pillar
addBlock(10, 3, -7, 12, 0.3, 2.5, 0x6B4423);   // deck x[4,16]
// West ramp: x[1,4] high at x=4 → '+x', top=3
addRamp(2.5, 0, -7, 3, 3, 2.5, '+x', 0xA08060);
// East ramp: x[16,19] high at x=16 → '-x', top=3
addRamp(17.5, 0, -7, 3, 3, 2.5, '-x', 0xA08060);

// ==============================================
// BRIDGE 2 — west side, spans along Z
// Deck at y=2.5, z[1,11] x[-9.25,-6.75]
// Ramps flush on both ends
// ==============================================
addBlock(-8, 0, 3,  1.2, 2.5, 1.2, 0x5C5C5C);  // pillar
addBlock(-8, 0, 9,  1.2, 2.5, 1.2, 0x5C5C5C);  // pillar
addBlock(-8, 2.5, 6, 2.5, 0.3, 10, 0x6B4423);  // deck z[1,11]
// North ramp: z[-2,1] high at z=1 → '+z', top=2.5
addRamp(-8, 0, -0.5, 2.5, 2.5, 3, '+z', 0xA08060);
// South ramp: z[11,14] high at z=11 → '-z', top=2.5
addRamp(-8, 0, 12.5, 2.5, 2.5, 3, '-z', 0xA08060);

// ==============================================
// ROOM — northwest, enclosed with doorway on south
// Interior ~6x6, center (-16,-18)
// Walls: x[-19.2,-12.8] z[-21.2,-14.8]
// ==============================================
// North wall
addBlock(-16, 0, -21.2, 6.8, 3.5, 0.4, 0x666666);
// South wall — split for doorway (2-unit gap in middle)
addBlock(-18.2, 0, -14.8, 2.4, 3.5, 0.4, 0x666666); // left x[-19.4,-17]
addBlock(-13.8, 0, -14.8, 2.4, 3.5, 0.4, 0x666666); // right x[-15,-12.6]
// West wall
addBlock(-19.2, 0, -18, 0.4, 3.5, 6, 0x666666);     // z[-21,-15]
// East wall
addBlock(-12.8, 0, -18, 0.4, 3.5, 6, 0x666666);
// Roof
addBlock(-16, 3.5, -18, 7.2, 0.3, 7.2, 0x555555);
// Cover inside
addBlock(-18, 0, -19.5, 1.5, 1.5, 1.5, 0xB8860B);
addBlock(-14, 0, -16.5, 1, 2, 1, 0xB8860B);

// ==============================================
// OBSTACLE COURSE 1 — northeast, ascending jumps
// x[8,22] z[-22,-19], blocks at increasing heights
// ==============================================
addBlock(9,  0, -20.5, 2, 0.8, 2, 0xA0522D);   // top=0.8
addBlock(12, 0, -20.5, 2, 1.6, 2, 0xB8860B);   // top=1.6
addBlock(15, 0, -20.5, 2, 2.4, 2, 0x8B6914);   // top=2.4
addBlock(18, 0, -20.5, 2, 3.2, 2, 0xA0522D);   // top=3.2
addBlock(21, 0, -20.5, 2.5, 4, 2.5, 0xB8860B); // top=4

// ==============================================
// OBSTACLE COURSE 2 — southeast, zigzag stepping
// x[12,23] z[19,24], alternating z offset
// ==============================================
addBlock(13, 0, 20, 2, 0.8, 2, 0x8B6914);       // top=0.8
addBlock(16, 0, 22.5, 2, 1.2, 2, 0xA0522D);     // top=1.2
addBlock(19, 0, 20, 2, 1.8, 2, 0xB8860B);       // top=1.8
addBlock(22, 0, 22.5, 2, 2.4, 2, 0x8B6914);     // top=2.4

// ==============================================
// OBSTACLE COURSE 3 — west, stepping stones + ramp
// x[-24,-14] z[16,23], varied heights with connecting ramp
// ==============================================
addBlock(-23, 0, 17, 2, 0.6, 2, 0xB8860B);      // top=0.6
addBlock(-20, 0, 19, 2, 1.3, 2, 0x8B6914);      // top=1.3
addBlock(-17, 0, 17, 2, 2, 2, 0xA0522D);        // top=2
// Ramp connecting last block down to ground east: x[-16,-14] high at x=-16 → '-x'
addRamp(-15, 0, 17, 2, 2, 2, '-x', 0xA08060);
addBlock(-20, 0, 22, 2.5, 1.5, 2.5, 0xB8860B); // separate tall step
addBlock(-23, 0, 22, 2, 2.5, 2, 0x8B6914);      // highest

// ==============================================
// PLATFORM 1 — center-east
// x[5.5,8.5] z[5.5,8.5] top=2
// Ramp from south: z[8.5,11.5] high at z=8.5
// ==============================================
addBlock(7, 0, 7, 3, 2, 3, 0x6B5B4F);
addRamp(7, 0, 10, 3, 2, 3, '-z', 0xA08060);

// ==============================================
// PLATFORM 2 — west-center
// x[-13.5,-10.5] z[-4.5,-1.5] top=1.5
// Ramp from east: x[-10.5,-7.5] high at x=-10.5
// ==============================================
addBlock(-12, 0, -3, 3, 1.5, 3, 0x5C5C5C);
addRamp(-9, 0, -3, 3, 1.5, 3, '-x', 0xA08060);

// ==============================================
// PLATFORM 3 — far northeast
// x[20,24] z[-12,-8] top=3
// Ramp from south: z[-8,-5] high at z=-8
// ==============================================
addBlock(22, 0, -10, 4, 3, 4, 0x6B5B4F);
addRamp(22, 0, -6.5, 4, 3, 3, '-z', 0xA08060);

// ==============================================
// PLATFORM 4 — south-center
// x[-7,-4] z[20,23] top=2
// Ramp from north: z[17,20] high at z=20 → '+z'
// ==============================================
addBlock(-5.5, 0, 21.5, 3, 2, 3, 0x5C5C5C);
addRamp(-5.5, 0, 18.5, 3, 2, 3, '+z', 0xA08060);

// ==============================================
// PLATFORM 5 — north-center
// x[-2,2] z[-22,-19] top=2
// Ramp from south: z[-19,-16] high at z=-19 → '-z'
// ==============================================
addBlock(0, 0, -20.5, 4, 2, 3, 0x6B5B4F);
addRamp(0, 0, -17.5, 4, 2, 3, '-z', 0xA08060);

// ==============================================
// PLATFORM 6 — southwest
// x[-24,-21] z[8,11] top=2.5
// Ramp from east: x[-21,-18] high at x=-21 → '-x'
// ==============================================
addBlock(-22.5, 0, 9.5, 3, 2.5, 3, 0x5C5C5C);
addRamp(-19.5, 0, 9.5, 3, 2.5, 3, '-x', 0xA08060);

// ==============================================
// PLATFORM 7 — east-center
// x[13,16] z[9,12] top=1.5
// Ramp from west: x[10,13] high at x=13 → '+x'
// ==============================================
addBlock(14.5, 0, 10.5, 3, 1.5, 3, 0x6B5B4F);
addRamp(11.5, 0, 10.5, 3, 1.5, 3, '+x', 0xA08060);

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

      showPhaseOverlay('ROUND OVER!', `${msg.lastTaggerUsername} was the last tagger`, 4000);
    }

    if (msg.type === 'tagged') {
      addChat(`${msg.taggerUsername} tagged ${msg.taggedUsername}!`);
    }

    if (msg.type === 'chat') {
      addChat(msg.text);
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
window.addEventListener('keydown', e => {
  if (!gameStarted) return;
  if (e.code === 'KeyC' && !keys['KeyC']) crouching = !crouching;
  keys[e.code] = true;
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

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

  let spd = iAmTagger ? TAGGER_SPEED : SPEED;
  if (crouching) spd *= CROUCH_SPEED_MULT;
  const len = Math.sqrt(mx*mx + mz*mz);
  if (len > 0) { mx = mx/len*spd*dt; mz = mz/len*spd*dt; }

  if (keys['Space'] && onGround) {
    crouching = false;
    velocityY = JUMP_FORCE;
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
