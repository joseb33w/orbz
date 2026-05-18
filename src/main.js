import { NetworkClient } from './net.js';
import {
  OrbzGame,
  Player,
  PLAYER_COLORS,
  WORLD_SIZE,
  PLAYER_START_RADIUS,
  randomRoomCode,
} from './game.js';
import { saveScore, fetchTopScores } from './leaderboard.js';

const STORAGE_USER_ID = 'orbz_user_id';
const STORAGE_NAME = 'orbz_name';

function getOrCreateUserId() {
  let id = localStorage.getItem(STORAGE_USER_ID);
  if (!id) {
    id = (crypto.randomUUID?.() || Math.random().toString(36).slice(2)) + '_' + Date.now();
    localStorage.setItem(STORAGE_USER_ID, id);
  }
  return id;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function pickColor(usedColors) {
  const used = new Set(usedColors.map((c) => c.fill));
  const avail = PLAYER_COLORS.filter((c) => !used.has(c.fill));
  const pool = avail.length ? avail : PLAYER_COLORS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function spawnPosition(existingPlayers) {
  const margin = 200;
  for (let attempt = 0; attempt < 30; attempt++) {
    const x = margin + Math.random() * (WORLD_SIZE - margin * 2);
    const y = margin + Math.random() * (WORLD_SIZE - margin * 2);
    let ok = true;
    for (const p of existingPlayers) {
      if (Math.hypot(p.x - x, p.y - y) < PLAYER_START_RADIUS * 12) { ok = false; break; }
    }
    if (ok) return { x, y };
  }
  return {
    x: margin + Math.random() * (WORLD_SIZE - margin * 2),
    y: margin + Math.random() * (WORLD_SIZE - margin * 2),
  };
}

class App {
  constructor() {
    this.userId = getOrCreateUserId();
    this.name = localStorage.getItem(STORAGE_NAME) || '';
    this.app = document.getElementById('app');
    this.canvas = document.getElementById('game-canvas');
    this.uiRoot = document.getElementById('ui-root');

    this.net = null;
    this.game = null;
    this.phase = 'menu';
    this.roomCode = null;
    this.roomMembers = new Map();
    this.spawnAssignments = new Map();
    this.hostId = null;
    this.gameResults = null;
    this.pendingNet = null;

    this.renderMenu();

    window.addEventListener('beforeunload', () => {
      if (this.net) this.net.leave();
    });
  }

  get isHost() {
    return this.hostId === this.userId;
  }

  renderMenu(err = '') {
    this.phase = 'menu';
    document.body.classList.remove('in-game');
    this.canvas.style.display = 'none';
    this.app.innerHTML = `
      <div class="scene-stars"></div>
      <div class="scene">
        <div class="panel">
          <h1 class="brand">ORBZ</h1>
          <p class="tagline">Real-time arena · 2–6 players</p>
          <label class="field">
            <span class="field-label">Your name</span>
            <input id="name-input" class="input" type="text" maxlength="20" placeholder="Pick a name" value="${escapeHtml(this.name)}" autocomplete="off" />
          </label>
          <div class="btn-row">
            <button id="btn-create" class="btn">⊕ Create Room</button>
            <button id="btn-join" class="btn btn-secondary">Join with Code</button>
            <button id="btn-leaderboard" class="btn btn-ghost">Global Leaderboard</button>
          </div>
          <div id="menu-error" class="error">${escapeHtml(err)}</div>
        </div>
      </div>
    `;
    const nameInput = document.getElementById('name-input');
    nameInput.focus();
    nameInput.addEventListener('input', () => {
      this.name = nameInput.value.trim();
      localStorage.setItem(STORAGE_NAME, this.name);
    });

    document.getElementById('btn-create').addEventListener('click', () => this.handleCreate());
    document.getElementById('btn-join').addEventListener('click', () => this.renderJoinForm());
    document.getElementById('btn-leaderboard').addEventListener('click', () => this.renderLeaderboard());
  }

  renderJoinForm(err = '', code = '') {
    this.app.innerHTML = `
      <div class="scene-stars"></div>
      <div class="scene">
        <div class="panel">
          <h1 class="brand">ORBZ</h1>
          <p class="tagline">Enter the 4-letter room code</p>
          <label class="field">
            <span class="field-label">Your name</span>
            <input id="name-input" class="input" type="text" maxlength="20" placeholder="Pick a name" value="${escapeHtml(this.name)}" autocomplete="off" />
          </label>
          <label class="field">
            <span class="field-label">Room code</span>
            <input id="code-input" class="input code" type="text" maxlength="4" placeholder="ABCD" value="${escapeHtml(code)}" autocomplete="off" />
          </label>
          <div class="btn-row btn-row-2">
            <button id="btn-back" class="btn btn-secondary">Back</button>
            <button id="btn-go" class="btn">Join</button>
          </div>
          <div id="menu-error" class="error">${escapeHtml(err)}</div>
        </div>
      </div>
    `;
    const codeInput = document.getElementById('code-input');
    const nameInput = document.getElementById('name-input');
    codeInput.focus();
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4);
    });
    nameInput.addEventListener('input', () => {
      this.name = nameInput.value.trim();
      localStorage.setItem(STORAGE_NAME, this.name);
    });
    const go = () => this.handleJoin(codeInput.value);
    document.getElementById('btn-go').addEventListener('click', go);
    codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    document.getElementById('btn-back').addEventListener('click', () => this.renderMenu());
  }

  async handleCreate() {
    if (!this.validateName()) return;
    const code = randomRoomCode();
    await this.joinRoom(code);
  }

  async handleJoin(code) {
    if (!this.validateName()) return;
    code = (code || '').trim().toUpperCase();
    if (code.length !== 4 || !/^[A-Z]+$/.test(code)) {
      this.renderJoinForm('Room codes are exactly 4 letters.', code);
      return;
    }
    await this.joinRoom(code);
  }

  validateName() {
    if (!this.name || this.name.trim().length === 0) {
      const el = document.getElementById('menu-error');
      if (el) el.textContent = 'Please enter a name first.';
      return false;
    }
    return true;
  }

  async joinRoom(code) {
    this.roomCode = code;
    this.renderLobbyConnecting();

    if (this.net) {
      await this.net.leave();
      this.net = null;
    }

    this.net = new NetworkClient(this.userId);
    this.bindNetHandlers();

    const presenceInfo = {
      user_id: this.userId,
      name: this.name.slice(0, 20),
      joined_at: Date.now(),
    };

    try {
      await this.net.joinRoom(code, presenceInfo);
    } catch (e) {
      console.error(e);
      this.net = null;
      this.renderMenu('Could not connect to the room. Check your connection and try again.');
      return;
    }

    this.phase = 'lobby';
  }

  bindNetHandlers() {
    this.net.on('presenceSync', (state) => this.handlePresenceSync(state));
    this.net.on('gameStart', (payload) => this.handleGameStart(payload));
    this.net.on('gameEnd', (payload) => this.handleGameEnd(payload));
    this.net.on('state', (payload) => this.handleRemoteState(payload));
    this.net.on('orbState', (payload) => this.handleOrbState(payload));
    this.net.on('orbEaten', (payload) => this.handleOrbEaten(payload));
    this.net.on('playerEaten', (payload) => this.handlePlayerEaten(payload));
  }

  handlePresenceSync(state) {
    const next = new Map();
    let earliest = null;
    for (const [userId, presences] of Object.entries(state)) {
      const p = presences[0];
      next.set(userId, p);
      if (!earliest || (p.joined_at && p.joined_at < earliest.joined_at)) {
        earliest = { user_id: userId, joined_at: p.joined_at };
      }
    }
    this.roomMembers = next;
    const wasHost = this.hostId === this.userId;
    this.hostId = earliest?.user_id ?? null;
    const becameHost = !wasHost && this.hostId === this.userId;

    if (this.phase === 'lobby') {
      this.renderLobby();
    } else if (this.phase === 'playing' && this.game) {
      for (const id of [...this.game.players.keys()]) {
        if (!this.roomMembers.has(id)) {
          this.game.removePlayer(id);
        }
      }
      if (becameHost) {
        this.game.isHost = true;
      }
    }
  }

  renderLobbyConnecting() {
    document.body.classList.remove('in-game');
    this.canvas.style.display = 'none';
    this.app.innerHTML = `
      <div class="scene-stars"></div>
      <div class="scene">
        <div class="panel">
          <h1 class="brand">ORBZ</h1>
          <p class="tagline">Connecting to room <strong>${escapeHtml(this.roomCode)}</strong>…</p>
          <div class="center-load"><div class="spinner"></div></div>
        </div>
      </div>
    `;
  }

  renderLobby() {
    document.body.classList.remove('in-game');
    this.canvas.style.display = 'none';
    const members = [...this.roomMembers.entries()].sort((a, b) => (a[1].joined_at ?? 0) - (b[1].joined_at ?? 0));
    const count = members.length;
    const canStart = this.isHost && count >= 2 && count <= 6;
    const tooMany = count > 6;

    const rows = members.map(([uid, p], i) => {
      const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
      const isMe = uid === this.userId;
      const isHost = uid === this.hostId;
      return `
        <li class="player-row">
          <span class="player-dot" style="background:${color.fill};color:${color.glow}"></span>
          <span class="player-name">${escapeHtml(p.name || 'Anon')}</span>
          ${isHost ? '<span class="player-tag">Host</span>' : ''}
          ${isMe ? '<span class="player-tag you">You</span>' : ''}
        </li>
      `;
    }).join('');

    this.app.innerHTML = `
      <div class="scene-stars"></div>
      <div class="scene">
        <div class="panel panel-wide">
          <div class="room-code-box">
            <div class="room-code-label">Room Code</div>
            <div class="room-code-value">${escapeHtml(this.roomCode)}</div>
            <button id="copy-code" class="copy-btn">Copy code</button>
          </div>
          <div class="hr"></div>
          <div class="field-label">Players in room (${count}/6)</div>
          <ul class="player-list">${rows}</ul>
          ${tooMany ? '<div class="error">Room is over capacity (max 6). Some players need to leave.</div>' : ''}
          <div class="btn-row btn-row-2">
            <button id="btn-leave" class="btn btn-secondary">Leave Room</button>
            <button id="btn-start" class="btn" ${canStart ? '' : 'disabled'}>
              ${this.isHost ? (count < 2 ? 'Need 2+ players' : 'Start Game') : 'Waiting for host…'}
            </button>
          </div>
          <p class="lobby-hint">Share the room code with friends so they can join you.</p>
        </div>
      </div>
    `;

    document.getElementById('btn-leave').addEventListener('click', () => this.handleLeave());
    document.getElementById('copy-code').addEventListener('click', () => {
      navigator.clipboard?.writeText(this.roomCode).catch(() => {});
      const btn = document.getElementById('copy-code');
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy code', 1200); }
    });
    if (canStart) {
      document.getElementById('btn-start').addEventListener('click', () => this.handleStartGame());
    }
  }

  async handleLeave() {
    if (this.net) await this.net.leave();
    this.net = null;
    this.roomCode = null;
    this.roomMembers.clear();
    this.hostId = null;
    if (this.game) { this.game.stop(); this.game = null; }
    this.renderMenu();
  }

  handleStartGame() {
    if (!this.isHost) return;
    const members = [...this.roomMembers.entries()].sort((a, b) => (a[1].joined_at ?? 0) - (b[1].joined_at ?? 0));
    const assignments = [];
    const usedColors = [];
    const existing = [];
    for (const [uid, info] of members) {
      const color = pickColor(usedColors);
      usedColors.push(color);
      const pos = spawnPosition(existing);
      existing.push({ x: pos.x, y: pos.y });
      assignments.push({
        user_id: uid,
        name: (info.name || 'Anon').slice(0, 20),
        color,
        x: pos.x,
        y: pos.y,
      });
    }
    const payload = { assignments, startedAt: Date.now() };
    this.net.broadcast('game_start', payload);
    this.handleGameStart(payload);
  }

  handleGameStart(payload) {
    if (!payload || !Array.isArray(payload.assignments)) return;
    this.phase = 'playing';
    this.gameResults = null;
    this.app.innerHTML = '';
    document.body.classList.add('in-game');
    this.canvas.style.display = 'block';

    this.game = new OrbzGame({
      canvas: this.canvas,
      selfId: this.userId,
      isHost: this.isHost,
      callbacks: {
        onBroadcastState: (state) => this.net.broadcast('state', state),
        onBroadcastOrbSpawn: (data) => this.net.broadcast('orb_state', data),
        onBroadcastOrbState: (data) => this.net.broadcast('orb_state', data),
        onOrbEaten: (orbId, newR) => this.net.broadcast('orb_eaten', { orbId, eaterId: this.userId, newR }),
        onPlayerEaten: ({ victimId, eaterId, eaterRadius }) => {
          this.net.broadcast('player_eaten', { victimId, eaterId, eaterRadius });
        },
        onGameOver: ({ winnerId }) => {
          if (this.isHost) {
            const stats = this.collectGameStats(winnerId);
            this.net.broadcast('game_end', { winnerId, stats, endedAt: Date.now() });
            this.handleGameEnd({ winnerId, stats, endedAt: Date.now() });
          }
        },
      },
    });

    for (const a of payload.assignments) {
      const p = new Player({
        id: a.user_id,
        name: a.name,
        color: a.color,
        x: a.x,
        y: a.y,
      });
      this.game.addPlayer(p);
    }

    this.renderHud();
    this.game.start();
  }

  collectGameStats(winnerId) {
    const stats = [];
    if (!this.game) return stats;
    for (const p of this.game.players.values()) {
      stats.push({
        user_id: p.id,
        name: p.name,
        color: p.color,
        score: p.score,
        radius: p.r,
        eliminations: p.eliminations,
        alive: p.alive,
        won: p.id === winnerId,
      });
    }
    stats.sort((a, b) => b.score - a.score);
    return stats;
  }

  renderHud() {
    this.uiRoot.innerHTML = `
      <div class="hud" id="hud">
        <div class="hud-block hud-tl">
          <div class="hud-label">Score</div>
          <div class="hud-value" id="hud-score">0</div>
          <div class="hud-label" style="margin-top:8px">Survived</div>
          <div class="hud-value small" id="hud-time">0:00</div>
        </div>
        <div class="hud-block hud-tr">
          <div class="hud-label">Players Alive</div>
          <div class="hud-value" id="hud-alive">—</div>
          <div class="room-pill">Room ${escapeHtml(this.roomCode)}</div>
        </div>
        <div class="hud-block hud-br">
          <div class="hud-label">Standings</div>
          <div class="scoreboard" id="hud-scoreboard"></div>
        </div>
        <div class="hud-block hud-bl">
          <div class="hud-label">Controls</div>
          <div style="font-size:13px;line-height:1.5;color:#cbd5e1">
            WASD / Arrows to move<br/>
            Eat orbs to grow<br/>
            Absorb smaller players
          </div>
        </div>
      </div>
    `;
    this.hudTimer = setInterval(() => this.updateHud(), 200);
  }

  updateHud() {
    if (!this.game) return;
    const me = this.game.players.get(this.userId);
    const elScore = document.getElementById('hud-score');
    const elTime = document.getElementById('hud-time');
    const elAlive = document.getElementById('hud-alive');
    const elSb = document.getElementById('hud-scoreboard');
    if (!elScore) return;

    elScore.textContent = me ? String(me.score) : '0';
    const total = Math.floor(this.game.elapsed);
    const mm = String(Math.floor(total / 60));
    const ss = String(total % 60).padStart(2, '0');
    elTime.textContent = `${mm}:${ss}`;

    let alive = 0, totalPlayers = 0;
    for (const p of this.game.players.values()) { totalPlayers++; if (p.alive) alive++; }
    elAlive.textContent = `${alive} / ${totalPlayers}`;

    const arr = [...this.game.players.values()];
    arr.sort((a, b) => b.score - a.score);
    elSb.innerHTML = arr.slice(0, 6).map((p) => `
      <div class="score-row ${p.alive ? '' : 'dead'} ${p.id === this.userId ? 'me' : ''}">
        <span class="dot" style="background:${p.color.fill};color:${p.color.glow}"></span>
        <span class="name">${escapeHtml(p.name)}${p.id === this.userId ? ' (you)' : ''}</span>
        <span class="score">${p.score}</span>
      </div>
    `).join('');

    if (me && !me.alive && !document.getElementById('spectate-banner') && this.phase === 'playing') {
      const banner = document.createElement('div');
      banner.id = 'spectate-banner';
      banner.className = 'spectate-banner';
      banner.innerHTML = `
        <h2>You were absorbed</h2>
        <p>Now spectating — the round continues</p>
      `;
      document.body.appendChild(banner);
      setTimeout(() => {
        const b = document.getElementById('spectate-banner');
        if (b) b.remove();
        const small = document.createElement('div');
        small.id = 'spectate-banner-small';
        small.className = 'spectate-banner persistent';
        small.style.left = '50%';
        small.innerHTML = `
          <h2>Spectating</h2>
          <p id="spectate-target">Following leader</p>
        `;
        document.body.appendChild(small);
      }, 2400);
    }
    if (me && me.alive) {
      const b = document.getElementById('spectate-banner');
      if (b) b.remove();
      const s = document.getElementById('spectate-banner-small');
      if (s) s.remove();
    } else if (me && !me.alive) {
      const target = document.getElementById('spectate-target');
      if (target && this.game.spectateId) {
        const t = this.game.players.get(this.game.spectateId);
        if (t) target.textContent = `Following ${t.name}`;
      }
    }
  }

  handleRemoteState(payload) {
    if (!this.game || !payload || payload.id === this.userId) return;
    let p = this.game.players.get(payload.id);
    if (!p) {
      p = new Player({
        id: payload.id,
        name: payload.name || 'Anon',
        color: payload.color || PLAYER_COLORS[0],
        x: payload.x,
        y: payload.y,
      });
      this.game.addPlayer(p);
    }
    p.name = payload.name || p.name;
    p.color = payload.color || p.color;
    p.applyRemote({ x: payload.x, y: payload.y, r: payload.r, alive: payload.alive });
    if (typeof payload.eliminations === 'number') p.eliminations = payload.eliminations;
  }

  handleOrbState(payload) {
    if (!this.game || !payload || !Array.isArray(payload.orbs)) return;
    if (this.isHost) return;
    this.game.setOrbsFromState(payload.orbs);
  }

  handleOrbEaten(payload) {
    if (!this.game || !payload) return;
    if (payload.eaterId === this.userId) return;
    this.game.removeOrb(payload.orbId);
    const eater = this.game.players.get(payload.eaterId);
    if (eater && typeof payload.newR === 'number') {
      eater.r = payload.newR;
    }
  }

  handlePlayerEaten(payload) {
    if (!this.game || !payload) return;
    const victim = this.game.players.get(payload.victimId);
    if (victim) victim.alive = false;
    const eater = this.game.players.get(payload.eaterId);
    if (eater && typeof payload.eaterRadius === 'number') {
      eater.r = payload.eaterRadius;
      eater.eliminations++;
    }
  }

  handleGameEnd(payload) {
    if (!payload) return;
    if (this.hudTimer) { clearInterval(this.hudTimer); this.hudTimer = null; }
    this.gameResults = payload;
    if (this.game) { this.game.stop(); }
    setTimeout(() => this.renderGameOver(payload), 200);
  }

  async renderGameOver(payload) {
    this.phase = 'gameover';
    document.body.classList.remove('in-game');
    this.canvas.style.display = 'none';
    this.uiRoot.innerHTML = '';
    const sb = document.getElementById('spectate-banner');
    if (sb) sb.remove();
    const sb2 = document.getElementById('spectate-banner-small');
    if (sb2) sb2.remove();

    const stats = Array.isArray(payload.stats) ? payload.stats : [];
    const winnerId = payload.winnerId;
    const winner = stats.find((s) => s.user_id === winnerId);
    const me = stats.find((s) => s.user_id === this.userId);

    if (me && this.roomCode) {
      try {
        await saveScore({
          userId: this.userId,
          playerName: me.name,
          score: me.score,
          roomCode: this.roomCode,
          survivalSeconds: this.game?.elapsed ?? 0,
          playersEliminated: me.eliminations ?? 0,
          won: !!me.won,
        });
      } catch (e) {
        console.warn('Failed to save score:', e);
      }
    }

    this.app.innerHTML = `
      <div class="scene-stars"></div>
      <div class="scene">
        <div class="panel gameover-panel">
          <div class="winner-line">
            <div class="winner-trophy">🏆</div>
            <div class="winner-title">${winner ? escapeHtml(winner.name) + ' Wins!' : 'No Survivors'}</div>
            <div class="winner-subtitle">${winner ? `Final size: ${winner.score}` : 'Round ended in a draw.'}</div>
          </div>
          <div class="field-label">Final Standings</div>
          <ul class="final-scores">
            ${stats.map((s, i) => `
              <li class="${s.won ? 'winner' : ''}">
                <span class="rank">#${i + 1}</span>
                <span class="player-dot" style="background:${s.color.fill};color:${s.color.glow}"></span>
                <span class="name">${escapeHtml(s.name)}${s.user_id === this.userId ? ' (you)' : ''}</span>
                <span class="stat">${s.score} · ${s.eliminations} elim</span>
              </li>
            `).join('')}
          </ul>
          <div class="btn-row btn-row-2">
            <button id="btn-again" class="btn">Play Again</button>
            <button id="btn-menu" class="btn btn-secondary">Back to Menu</button>
          </div>
          <button id="btn-lb" class="btn btn-ghost" style="margin-top:8px">View Global Leaderboard</button>
        </div>
      </div>
    `;

    document.getElementById('btn-again').addEventListener('click', () => this.handlePlayAgain());
    document.getElementById('btn-menu').addEventListener('click', () => this.handleLeave());
    document.getElementById('btn-lb').addEventListener('click', () => this.renderLeaderboard(true));
  }

  handlePlayAgain() {
    if (this.game) { this.game.stop(); this.game = null; }
    if (this.uiRoot) this.uiRoot.innerHTML = '';
    this.gameResults = null;
    this.phase = 'lobby';
    this.renderLobby();
  }

  async renderLeaderboard(fromGameOver = false) {
    this.phase = 'leaderboard';
    document.body.classList.remove('in-game');
    this.canvas.style.display = 'none';
    this.app.innerHTML = `
      <div class="scene-stars"></div>
      <div class="scene">
        <div class="panel panel-wide">
          <h1 class="brand" style="font-size:42px">Leaderboard</h1>
          <p class="tagline">Top scores across all rooms</p>
          <div id="lb-content"><div class="center-load"><div class="spinner"></div></div></div>
          <div class="btn-row">
            <button id="btn-lb-back" class="btn btn-secondary">${fromGameOver ? 'Back' : 'Back to Menu'}</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('btn-lb-back').addEventListener('click', () => {
      if (fromGameOver && this.gameResults) {
        this.renderGameOver(this.gameResults);
      } else {
        this.renderMenu();
      }
    });

    let rows = [];
    try {
      rows = await fetchTopScores(20);
    } catch (e) {
      console.warn(e);
    }
    const content = document.getElementById('lb-content');
    if (!content) return;
    if (rows.length === 0) {
      content.innerHTML = '<div class="lb-empty">No scores yet — be the first to win!</div>';
      return;
    }
    content.innerHTML = `
      <ul class="lb-list">
        ${rows.map((r, i) => `
          <li class="lb-row ${i < 3 ? `top-${i + 1}` : ''}">
            <span class="rank">${i + 1}</span>
            <span class="name">${escapeHtml(r.player_name)}${r.won ? ' 👑' : ''}</span>
            <span class="room">${escapeHtml(r.room_code)}</span>
            <span class="score">${r.score}</span>
          </li>
        `).join('')}
      </ul>
    `;
  }
}

window.__app = new App();
