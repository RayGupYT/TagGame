const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
};

const server = http.createServer((req, res) => {
  const filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

// --- Game state ---
const players = new Map();
let nextId = 1;
let taggerId = null;
const TAG_DIST = 2.0;
const TAG_COOLDOWN = 2000;
let lastTagTime = 0;

// Round management
const ROUND_DURATION = 5 * 60 * 1000;   // 5 minutes
const LOBBY_DURATION = 10 * 1000;        // 10 seconds
let gamePhase = 'lobby'; // 'lobby' or 'playing'
let phaseEndTime = Date.now() + LOBBY_DURATION;

// Tagger time tracking
const taggerTime = new Map(); // playerId -> ms spent as tagger
let taggerSwitchedAt = 0; // timestamp when current tagger became it

// Lobby spawn point (center area)
const LOBBY_SPAWN = { x: 0, y: 0, z: 0 };

// Game spawn points spread around the map
const SPAWN_POINTS = [
  { x: -20, z: -20 }, { x: 20, z: -20 },
  { x: -20, z: 20 },  { x: 20, z: 20 },
  { x: 0, z: -20 },   { x: 0, z: 20 },
  { x: -20, z: 0 },   { x: 20, z: 0 },
  { x: -10, z: -15 }, { x: 10, z: -15 },
  { x: -10, z: 15 },  { x: 10, z: 15 },
  { x: -15, z: -8 },  { x: 15, z: 8 },
  { x: 5, z: -10 },   { x: -5, z: 10 },
];

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.ws.readyState === 1) p.ws.send(data);
  }
}

function broadcastState() {
  const list = [];
  for (const p of players.values()) {
    list.push({
      id: p.id, username: p.username,
      x: p.x, y: p.y, z: p.z, yaw: p.yaw,
      isTagger: p.id === taggerId
    });
  }
  const timeLeft = Math.max(0, phaseEndTime - Date.now());
  broadcast({ type: 'state', players: list, taggerId, gamePhase, timeLeft });
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startRound() {
  gamePhase = 'playing';
  phaseEndTime = Date.now() + ROUND_DURATION;

  if (players.size === 0) return;

  // Reset tagger time tracking
  taggerTime.clear();
  for (const p of players.values()) taggerTime.set(p.id, 0);

  // Pick random tagger
  const ids = [...players.keys()];
  taggerId = ids[Math.floor(Math.random() * ids.length)];
  taggerSwitchedAt = Date.now();
  lastTagTime = Date.now();

  // Assign random spawn points
  const spawns = shuffleArray(SPAWN_POINTS);
  let i = 0;
  const teleports = [];
  for (const p of players.values()) {
    const sp = spawns[i % spawns.length];
    p.x = sp.x;
    p.y = 0;
    p.z = sp.z;
    teleports.push({ id: p.id, x: sp.x, y: 0, z: sp.z });
    i++;
  }

  const tagger = players.get(taggerId);
  broadcast({
    type: 'roundStart',
    taggerId,
    taggerUsername: tagger ? tagger.username : '???',
    teleports,
    duration: ROUND_DURATION
  });
  broadcast({ type: 'chat', text: `Round started! ${tagger ? tagger.username : '???'} is IT!` });
  startPowerupSpawning();
  broadcastState();
}

function endRound() {
  gamePhase = 'lobby';
  phaseEndTime = Date.now() + LOBBY_DURATION;

  // Finalize tagger time for current tagger
  if (taggerId && taggerTime.has(taggerId)) {
    const elapsed = Date.now() - taggerSwitchedAt;
    taggerTime.set(taggerId, (taggerTime.get(taggerId) || 0) + elapsed);
  }

  // Build leaderboard sorted by least tagger time (winner first)
  const leaderboard = [];
  for (const p of players.values()) {
    const ms = taggerTime.get(p.id) || 0;
    leaderboard.push({ id: p.id, username: p.username, taggerTimeMs: ms });
  }
  leaderboard.sort((a, b) => a.taggerTimeMs - b.taggerTimeMs);

  const winner = leaderboard.length > 0 ? leaderboard[0].username : 'nobody';

  // Teleport everyone to lobby
  const teleports = [];
  let angle = 0;
  const angleStep = players.size > 0 ? (Math.PI * 2) / players.size : 0;
  for (const p of players.values()) {
    const lx = Math.cos(angle) * 5;
    const lz = Math.sin(angle) * 5;
    p.x = lx;
    p.y = 0;
    p.z = lz;
    teleports.push({ id: p.id, x: lx, y: 0, z: lz });
    angle += angleStep;
  }

  taggerId = null;

  broadcast({
    type: 'roundEnd',
    winner,
    leaderboard,
    teleports
  });
  stopPowerupSpawning();
  broadcast({ type: 'chat', text: `Round over! ${winner} wins with least tagger time!` });
  broadcastState();
}

// --- Powerups ---
const powerups = []; // { id, type, x, z }
let powerupNextId = 1;
const POWERUP_INTERVAL = 11000; // spawn 3 every 11 seconds
const POWERUP_PICKUP_DIST = 2.5;
const POWERUP_TYPES = ['speed', 'jump'];

function spawnPowerups() {
  if (gamePhase !== 'playing') return;
  for (let i = 0; i < 3; i++) {
    const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    const x = (Math.random() - 0.5) * 40;
    const z = (Math.random() - 0.5) * 40;
    const pu = { id: powerupNextId++, type, x, z };
    powerups.push(pu);
    broadcast({ type: 'powerupSpawn', powerup: pu });
  }
}

function checkPowerupPickup(player) {
  for (let i = powerups.length - 1; i >= 0; i--) {
    const pu = powerups[i];
    const dx = player.x - pu.x;
    const dz = player.z - pu.z;
    if (Math.sqrt(dx * dx + dz * dz) < POWERUP_PICKUP_DIST) {
      powerups.splice(i, 1);
      broadcast({ type: 'powerupPickup', powerupId: pu.id, playerId: player.id, powerupType: pu.type });
      return;
    }
  }
}

let powerupSpawnTimer = null;
function startPowerupSpawning() {
  if (powerupSpawnTimer) clearInterval(powerupSpawnTimer);
  powerups.length = 0;
  spawnPowerups(); // spawn first batch immediately
  powerupSpawnTimer = setInterval(spawnPowerups, POWERUP_INTERVAL);
}
function stopPowerupSpawning() {
  if (powerupSpawnTimer) clearInterval(powerupSpawnTimer);
  powerupSpawnTimer = null;
  powerups.length = 0;
  broadcast({ type: 'powerupClearAll' });
}

// --- Teleporters ---
const TELEPORTER_PADS = [
  { x: -20, z: -20 },  // NW corner
  { x: 20, z: -20 },   // NE corner
  { x: -20, z: 20 },   // SW corner
  { x: 20, z: 20 },    // SE corner
];
const TELEPORTER_DIST = 2.0;
const TELEPORTER_COOLDOWN = 30000;
const teleporterCooldowns = new Map(); // playerId -> timestamp

function checkTeleporter(player, id, ws) {
  const now = Date.now();
  const lastUse = teleporterCooldowns.get(id) || 0;
  if (now - lastUse < TELEPORTER_COOLDOWN) return;

  for (let i = 0; i < TELEPORTER_PADS.length; i++) {
    const pad = TELEPORTER_PADS[i];
    const dx = player.x - pad.x;
    const dz = player.z - pad.z;
    if (Math.sqrt(dx * dx + dz * dz) < TELEPORTER_DIST) {
      // Pick a random OTHER pad
      const others = TELEPORTER_PADS.filter((_, j) => j !== i);
      const dest = others[Math.floor(Math.random() * others.length)];
      player.x = dest.x;
      player.y = 0;
      player.z = dest.z;
      teleporterCooldowns.set(id, now);
      ws.send(JSON.stringify({ type: 'teleport', x: dest.x, y: 0, z: dest.z }));
      broadcast({ type: 'teleportEffect', fromX: pad.x, fromZ: pad.z, toX: dest.x, toZ: dest.z });
      return;
    }
  }
}

// --- Game tick: broadcast positions at 20 ticks/sec ---
setInterval(() => {
  if (players.size === 0) return;
  broadcastState();
}, 50);

// --- Phase tick: check round transitions every second ---
setInterval(() => {
  const now = Date.now();
  if (now >= phaseEndTime) {
    if (gamePhase === 'lobby') {
      if (players.size >= 2) {
        startRound();
      } else {
        phaseEndTime = now + LOBBY_DURATION;
        broadcast({ type: 'chat', text: 'Need at least 2 players to start a round.' });
      }
    } else {
      endRound();
    }
  }
}, 1000);

// --- Connections ---
wss.on('connection', (ws) => {
  const id = nextId++;
  const player = { id, username: 'Player', x: 0, y: 0, z: 0, yaw: 0, ws };

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      player.username = (msg.username || 'Player').slice(0, 20);

      // Spawn in lobby area (circle)
      const angle = Math.random() * Math.PI * 2;
      player.x = Math.cos(angle) * 5;
      player.z = Math.sin(angle) * 5;

      players.set(id, player);

      ws.send(JSON.stringify({
        type: 'welcome', id, gamePhase, taggerId,
        timeLeft: Math.max(0, phaseEndTime - Date.now()),
        x: player.x, y: 0, z: player.z
      }));
      broadcast({ type: 'chat', text: `${player.username} joined the game!` });
      // Send existing powerups to new player
      for (const pu of powerups) {
        ws.send(JSON.stringify({ type: 'powerupSpawn', powerup: pu }));
      }
      broadcastState();
    }

    if (msg.type === 'move') {
      player.x = msg.x;
      player.y = msg.y;
      player.z = msg.z;
      player.yaw = msg.yaw;

      // Only check tags during playing phase
      if (gamePhase === 'playing' && id === taggerId && Date.now() - lastTagTime > TAG_COOLDOWN) {
        for (const other of players.values()) {
          if (other.id === id) continue;
          const dx = player.x - other.x;
          const dy = player.y - other.y;
          const dz = player.z - other.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist < TAG_DIST) {
            const oldTagger = player.username;
            const now = Date.now();
            // Accumulate time for old tagger
            const elapsed = now - taggerSwitchedAt;
            taggerTime.set(id, (taggerTime.get(id) || 0) + elapsed);
            taggerId = other.id;
            taggerSwitchedAt = now;
            lastTagTime = now;
            broadcast({
              type: 'tagged',
              taggerUsername: oldTagger,
              taggedUsername: other.username,
              newTaggerId: other.id
            });
            break;
          }
        }
      }
      // Check powerup pickup
      if (gamePhase === 'playing') checkPowerupPickup(player);
      // Check teleporter
      checkTeleporter(player, id, ws);
      // Position broadcast handled by game tick, not here
    }

    if (msg.type === 'emote') {
      broadcast({ type: 'emote', id, emote: msg.emote });
    }

    if (msg.type === 'chatMsg') {
      const text = (msg.text || '').trim().slice(0, 100);
      if (text) {
        broadcast({ type: 'playerChat', username: player.username, text });
      }
    }
  });

  ws.on('close', () => {
    const username = player.username;
    players.delete(id);

    if (gamePhase === 'playing' && taggerId === id && players.size > 0) {
      // Accumulate time for leaving tagger
      const elapsed = Date.now() - taggerSwitchedAt;
      taggerTime.set(id, (taggerTime.get(id) || 0) + elapsed);
      const remaining = [...players.keys()];
      taggerId = remaining[Math.floor(Math.random() * remaining.length)];
      taggerSwitchedAt = Date.now();
      const newTagger = players.get(taggerId);
      broadcast({ type: 'chat', text: `${username} left. ${newTagger.username} is now the tagger!` });
    } else if (players.size === 0) {
      taggerId = null;
      gamePhase = 'lobby';
      phaseEndTime = Date.now() + LOBBY_DURATION;
    } else {
      broadcast({ type: 'chat', text: `${username} left the game.` });
    }
    broadcastState();
  });
});

const PORT = parseInt(process.env.PORT, 10) || 3000;

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Waiting for players...');
});
