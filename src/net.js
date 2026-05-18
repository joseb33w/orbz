import { supabase } from './supabase.js';

export class NetworkClient {
  constructor(userId) {
    this.userId = userId;
    this.channel = null;
    this.roomCode = null;
    this.handlers = {};
  }

  on(event, handler) {
    this.handlers[event] = handler;
  }

  async joinRoom(roomCode, presenceInfo) {
    this.roomCode = roomCode;
    return new Promise((resolve, reject) => {
      const ch = supabase.channel(`orbz_room_${roomCode}`, {
        config: {
          presence: { key: this.userId },
          broadcast: { self: false, ack: false },
        },
      });

      const fire = (name) => ({ payload }) => this.handlers[name]?.(payload);
      ch.on('broadcast', { event: 'state' },         fire('state'));
      ch.on('broadcast', { event: 'orb_state' },     fire('orbState'));
      ch.on('broadcast', { event: 'orb_eaten' },     fire('orbEaten'));
      ch.on('broadcast', { event: 'player_eaten' },  fire('playerEaten'));
      ch.on('broadcast', { event: 'game_start' },    fire('gameStart'));
      ch.on('broadcast', { event: 'game_end' },      fire('gameEnd'));
      ch.on('broadcast', { event: 'lobby_kick' },    fire('lobbyKick'));

      ch.on('presence', { event: 'sync' }, () => {
        this.handlers.presenceSync?.(ch.presenceState());
      });
      ch.on('presence', { event: 'join' }, ({ key, newPresences }) => {
        this.handlers.presenceJoin?.(key, newPresences);
      });
      ch.on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        this.handlers.presenceLeave?.(key, leftPresences);
      });

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        supabase.removeChannel(ch).catch(() => {});
        reject(new Error('Realtime connection timed out'));
      }, 10000);

      ch.subscribe(async (status, err) => {
        if (status === 'SUBSCRIBED') {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            await ch.track(presenceInfo);
            this.channel = ch;
            resolve(ch);
          } catch (e) {
            reject(e);
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err || new Error('Realtime channel error: ' + status));
        }
      });
    });
  }

  updatePresence(info) {
    if (!this.channel) return;
    return this.channel.track(info);
  }

  async leave() {
    if (this.channel) {
      try { await this.channel.untrack(); } catch {}
      try { await supabase.removeChannel(this.channel); } catch {}
      this.channel = null;
    }
  }

  broadcast(event, payload) {
    if (!this.channel) return;
    return this.channel.send({ type: 'broadcast', event, payload });
  }
}
