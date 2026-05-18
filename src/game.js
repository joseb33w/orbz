export const WORLD_SIZE = 4000;
export const PLAYER_START_RADIUS = 22;
export const ORB_RADIUS_MIN = 5;
export const ORB_RADIUS_MAX = 9;
export const ORB_COUNT = 60;
export const BROADCAST_HZ = 20;
export const ORB_STATE_INTERVAL_MS = 700;
export const ABSORB_RATIO = 1.15;
export const TRAIL_LEN = 18;

export const PLAYER_COLORS = [
  { fill: '#f97316', glow: '#fb923c' },
  { fill: '#22c55e', glow: '#4ade80' },
  { fill: '#3b82f6', glow: '#60a5fa' },
  { fill: '#ec4899', glow: '#f472b6' },
  { fill: '#a855f7', glow: '#c084fc' },
  { fill: '#eab308', glow: '#facc15' },
];

export const ORB_COLORS = [
  { fill: '#22d3ee', glow: '#67e8f9' },
  { fill: '#a78bfa', glow: '#c4b5fd' },
  { fill: '#f472b6', glow: '#fbcfe8' },
  { fill: '#34d399', glow: '#6ee7b7' },
  { fill: '#fbbf24', glow: '#fde68a' },
  { fill: '#fb7185', glow: '#fecdd3' },
];

const TAU = Math.PI * 2;

export class Player {
  constructor({ id, name, color, x, y }) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.x = x;
    this.y = y;
    this.r = PLAYER_START_RADIUS;
    this.alive = true;
    this.trail = [];
    this.eliminations = 0;
    this.lastRemote = 0;
  }

  speed() {
    return 280 * Math.pow(PLAYER_START_RADIUS / this.r, 0.42);
  }

  get score() {
    return Math.round(Math.PI * this.r * this.r);
  }

  applyInput(dt, input) {
    if (!this.alive) return;
    let ax = 0, ay = 0;
    if (input.up) ay -= 1;
    if (input.down) ay += 1;
    if (input.left) ax -= 1;
    if (input.right) ax += 1;
    const mag = Math.hypot(ax, ay);
    if (mag > 0) {
      ax /= mag;
      ay /= mag;
      const sp = this.speed();
      this.x += ax * sp * dt;
      this.y += ay * sp * dt;
    }
    this.x = Math.max(this.r, Math.min(WORLD_SIZE - this.r, this.x));
    this.y = Math.max(this.r, Math.min(WORLD_SIZE - this.r, this.y));
    this.recordTrail();
  }

  recordTrail() {
    const last = this.trail[0];
    if (!last || (last.x - this.x) ** 2 + (last.y - this.y) ** 2 > 4) {
      this.trail.unshift({ x: this.x, y: this.y });
      if (this.trail.length > TRAIL_LEN) this.trail.length = TRAIL_LEN;
    }
  }

  applyRemote({ x, y, r, alive }) {
    this.x = x;
    this.y = y;
    this.r = r;
    this.alive = alive;
    this.lastRemote = performance.now();
    this.recordTrail();
  }
}

export class Orb {
  constructor({ id, x, y, r, color }) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.r = r;
    this.color = color;
    this.phase = Math.random() * TAU;
  }
}

function shortId() {
  return Math.random().toString(36).slice(2, 10);
}

export function randomRoomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

export class OrbzGame {
  constructor({ canvas, selfId, isHost, callbacks }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.selfId = selfId;
    this.isHost = isHost;
    this.callbacks = callbacks;

    this.players = new Map();
    this.orbs = new Map();
    this.eatenOrbIds = new Map();
    this.input = { up: false, down: false, left: false, right: false };
    this.camera = { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
    this.spectateId = null;

    this.running = false;
    this.startedAt = 0;
    this.elapsed = 0;
    this.lastFrameTime = 0;
    this.lastBroadcast = 0;
    this.lastOrbStateBroadcast = 0;
    this.lastEndCheck = 0;
    this.gameOverFired = false;

    this.stars = this.generateStars();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);

    this.resize = this.resize.bind(this);
    this.loop = this.loop.bind(this);
    this.onKey = this.onKey.bind(this);

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('resize', this.resize);
    window.addEventListener('blur', () => {
      this.input.up = this.input.down = this.input.left = this.input.right = false;
    });

    this.resize();
  }

  generateStars() {
    const stars = [];
    let seed = 1337;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) | 0;
      return ((seed >>> 0) / 0xffffffff);
    };
    for (let i = 0; i < 600; i++) {
      stars.push({
        x: rand() * WORLD_SIZE,
        y: rand() * WORLD_SIZE,
        r: 0.5 + rand() * 1.6,
        twinkle: rand() * TAU,
        speed: 0.5 + rand() * 1.5,
      });
    }
    return stars;
  }

  onKey(e, down) {
    const k = e.key.toLowerCase();
    let used = true;
    if (k === 'w' || k === 'arrowup') this.input.up = down;
    else if (k === 's' || k === 'arrowdown') this.input.down = down;
    else if (k === 'a' || k === 'arrowleft') this.input.left = down;
    else if (k === 'd' || k === 'arrowright') this.input.right = down;
    else used = false;
    if (used && e.preventDefault) e.preventDefault();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.viewWidth = w;
    this.viewHeight = h;
  }

  addPlayer(p) {
    if (!this.players.has(p.id)) this.players.set(p.id, p);
    return this.players.get(p.id);
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  setOrbsFromState(orbs) {
    this.orbs.clear();
    for (const o of orbs) {
      if (this.eatenOrbIds.has(o.id)) continue;
      this.orbs.set(o.id, new Orb(o));
    }
  }

  addOrb(o) {
    if (this.eatenOrbIds.has(o.id)) return;
    this.orbs.set(o.id, new Orb(o));
  }

  removeOrb(id) {
    this.orbs.delete(id);
    this.eatenOrbIds.set(id, performance.now());
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.startedAt = performance.now();
    this.elapsed = 0;
    this.lastFrameTime = performance.now();
    this.lastBroadcast = 0;
    this.lastOrbStateBroadcast = 0;
    this.gameOverFired = false;

    if (this.isHost && this.orbs.size === 0) {
      this.seedOrbs(ORB_COUNT);
    }
    requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
  }

  seedOrbs(count) {
    for (let i = 0; i < count; i++) {
      this.spawnOrb();
    }
  }

  spawnOrb() {
    const col = ORB_COLORS[Math.floor(Math.random() * ORB_COLORS.length)];
    const orb = new Orb({
      id: shortId(),
      x: 80 + Math.random() * (WORLD_SIZE - 160),
      y: 80 + Math.random() * (WORLD_SIZE - 160),
      r: ORB_RADIUS_MIN + Math.random() * (ORB_RADIUS_MAX - ORB_RADIUS_MIN),
      color: col,
    });
    this.orbs.set(orb.id, orb);
    return orb;
  }

  loop(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;
    this.elapsed = (now - this.startedAt) / 1000;
    this.update(dt, now);
    this.render(now);
    requestAnimationFrame(this.loop);
  }

  update(dt, now) {
    const me = this.players.get(this.selfId);

    if (me && me.alive) {
      me.applyInput(dt, this.input);
      this.camera.x += (me.x - this.camera.x) * Math.min(1, dt * 8);
      this.camera.y += (me.y - this.camera.y) * Math.min(1, dt * 8);

      for (const orb of this.orbs.values()) {
        const dx = orb.x - me.x, dy = orb.y - me.y;
        const d2 = dx * dx + dy * dy;
        const rr = (me.r + orb.r);
        if (d2 < rr * rr * 0.85) {
          const newR = Math.sqrt(me.r * me.r + orb.r * orb.r * 0.85);
          me.r = newR;
          this.orbs.delete(orb.id);
          this.eatenOrbIds.set(orb.id, now);
          this.callbacks.onOrbEaten?.(orb.id, newR);
        }
      }

      for (const other of this.players.values()) {
        if (other.id === me.id || !other.alive) continue;
        const dx = other.x - me.x, dy = other.y - me.y;
        const d = Math.hypot(dx, dy);
        if (me.r > other.r * ABSORB_RATIO && d < me.r * 0.9) {
          const newR = Math.sqrt(me.r * me.r + other.r * other.r);
          me.r = newR;
          me.eliminations++;
          other.alive = false;
          this.callbacks.onPlayerEaten?.({ victimId: other.id, eaterId: me.id, eaterRadius: newR });
        }
      }
    } else if (me && !me.alive) {
      let target = null;
      for (const p of this.players.values()) {
        if (p.alive && (!target || p.r > target.r)) target = p;
      }
      if (target) {
        this.spectateId = target.id;
        this.camera.x += (target.x - this.camera.x) * Math.min(1, dt * 4);
        this.camera.y += (target.y - this.camera.y) * Math.min(1, dt * 4);
      }
    }

    if (me && now - this.lastBroadcast > 1000 / BROADCAST_HZ) {
      this.lastBroadcast = now;
      this.callbacks.onBroadcastState?.({
        id: me.id,
        name: me.name,
        color: me.color,
        x: me.x,
        y: me.y,
        r: me.r,
        alive: me.alive,
        eliminations: me.eliminations,
      });
    }

    if (this.eatenOrbIds.size > 0) {
      for (const [id, ts] of this.eatenOrbIds) {
        if (now - ts > 3000) this.eatenOrbIds.delete(id);
      }
    }

    if (this.isHost) {
      while (this.orbs.size < ORB_COUNT && this.running) {
        const orb = this.spawnOrb();
        this.callbacks.onBroadcastOrbSpawn?.({ orbs: [serializeOrb(orb)] });
      }
      if (now - this.lastOrbStateBroadcast > ORB_STATE_INTERVAL_MS) {
        this.lastOrbStateBroadcast = now;
        const orbs = [];
        for (const o of this.orbs.values()) orbs.push(serializeOrb(o));
        this.callbacks.onBroadcastOrbState?.({ orbs });
      }

      if (!this.gameOverFired && now - this.lastEndCheck > 250) {
        this.lastEndCheck = now;
        let alive = 0, lastAlive = null;
        for (const p of this.players.values()) {
          if (p.alive) { alive++; lastAlive = p; }
        }
        const total = this.players.size;
        const minDur = 2;
        if (total >= 2 && alive <= 1 && this.elapsed > minDur) {
          this.gameOverFired = true;
          this.callbacks.onGameOver?.({ winnerId: lastAlive?.id ?? null });
        }
      }
    }
  }

  render(now) {
    const ctx = this.ctx;
    const W = this.viewWidth, H = this.viewHeight;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const bgGrad = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, Math.max(W, H));
    bgGrad.addColorStop(0, '#0e1338');
    bgGrad.addColorStop(0.6, '#070a23');
    bgGrad.addColorStop(1, '#03051a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    const camX = this.camera.x - W / 2;
    const camY = this.camera.y - H / 2;

    const t = now * 0.001;
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      const sx = s.x - camX * 0.6;
      const sy = s.y - camY * 0.6;
      if (sx < -2 || sx > W + 2 || sy < -2 || sy > H + 2) continue;
      const tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(s.twinkle + t * s.speed));
      ctx.globalAlpha = tw;
      ctx.fillStyle = '#dbe6ff';
      ctx.beginPath();
      ctx.arc(sx, sy, s.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(120, 130, 200, 0.06)';
    ctx.lineWidth = 1;
    const grid = 200;
    const startX = Math.floor(camX / grid) * grid;
    const startY = Math.floor(camY / grid) * grid;
    for (let x = startX; x < camX + W + grid; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x - camX, 0);
      ctx.lineTo(x - camX, H);
      ctx.stroke();
    }
    for (let y = startY; y < camY + H + grid; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y - camY);
      ctx.lineTo(W, y - camY);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(168, 85, 247, 0.5)';
    ctx.lineWidth = 4;
    ctx.shadowColor = '#a855f7';
    ctx.shadowBlur = 20;
    ctx.strokeRect(-camX, -camY, WORLD_SIZE, WORLD_SIZE);
    ctx.shadowBlur = 0;

    for (const orb of this.orbs.values()) {
      const ox = orb.x - camX;
      const oy = orb.y - camY;
      if (ox < -30 || ox > W + 30 || oy < -30 || oy > H + 30) continue;
      const pulse = 0.85 + 0.15 * Math.sin(orb.phase + t * 4);
      ctx.shadowColor = orb.color.glow;
      ctx.shadowBlur = 18 * pulse;
      ctx.fillStyle = orb.color.fill;
      ctx.beginPath();
      ctx.arc(ox, oy, orb.r * pulse, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = orb.color.glow;
      ctx.beginPath();
      ctx.arc(ox - orb.r * 0.3, oy - orb.r * 0.3, orb.r * 0.35, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.shadowBlur = 0;

    const playersArr = [...this.players.values()];
    for (const p of playersArr) {
      if (!p.alive) continue;
      const trail = p.trail;
      for (let i = trail.length - 1; i > 0; i--) {
        const t1 = trail[i], t0 = trail[i - 1];
        const tx0 = t0.x - camX, ty0 = t0.y - camY;
        const tx1 = t1.x - camX, ty1 = t1.y - camY;
        const alpha = (1 - i / trail.length) * 0.4;
        ctx.strokeStyle = p.color.glow;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = p.r * (1 - i / trail.length) * 1.4;
        ctx.lineCap = 'round';
        ctx.shadowColor = p.color.glow;
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.moveTo(tx0, ty0);
        ctx.lineTo(tx1, ty1);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    playersArr.sort((a, b) => a.r - b.r);
    for (const p of playersArr) {
      if (!p.alive) continue;
      const px = p.x - camX, py = p.y - camY;
      if (px < -p.r - 20 || px > W + p.r + 20 || py < -p.r - 20 || py > H + p.r + 20) continue;
      ctx.shadowColor = p.color.glow;
      ctx.shadowBlur = 28;
      ctx.fillStyle = p.color.fill;
      ctx.beginPath();
      ctx.arc(px, py, p.r, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = p.color.glow;
      ctx.beginPath();
      ctx.arc(px - p.r * 0.35, py - p.r * 0.35, p.r * 0.4, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (p.id === this.selfId) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, p.r + 2, 0, TAU);
        ctx.stroke();
      }
      const fontSize = Math.max(12, Math.min(22, p.r * 0.55));
      ctx.font = `700 ${fontSize}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(5, 7, 26, 0.85)';
      ctx.strokeText(p.name, px, py - p.r - fontSize * 0.9);
      ctx.fillStyle = '#fff';
      ctx.fillText(p.name, px, py - p.r - fontSize * 0.9);
      const scoreFs = Math.max(10, fontSize * 0.65);
      ctx.font = `600 ${scoreFs}px Orbitron, monospace`;
      ctx.strokeText(String(p.score), px, py - p.r - fontSize * 0.9 + fontSize * 0.8);
      ctx.fillStyle = p.color.glow;
      ctx.fillText(String(p.score), px, py - p.r - fontSize * 0.9 + fontSize * 0.8);
    }

    ctx.globalAlpha = 0.5;
    for (const p of playersArr) {
      if (p.alive) continue;
      const px = p.x - camX, py = p.y - camY;
      if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
      ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('☠ ' + p.name, px, py);
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }
}

export function serializeOrb(o) {
  return { id: o.id, x: o.x, y: o.y, r: o.r, color: o.color };
}
