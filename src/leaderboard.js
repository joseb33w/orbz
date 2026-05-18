import { supabase, LEADERBOARD_TABLE } from './supabase.js';

export async function saveScore({ userId, playerName, score, roomCode, survivalSeconds, playersEliminated, won }) {
  const row = {
    user_id: userId,
    player_name: (playerName || 'Anon').slice(0, 24),
    score: Math.max(0, Math.min(1000000, Math.round(score))),
    room_code: roomCode.slice(0, 4).toUpperCase(),
    survival_seconds: Math.max(0, Math.min(7200, Math.round(survivalSeconds))),
    players_eliminated: Math.max(0, Math.min(100, playersEliminated | 0)),
    won: !!won,
  };
  const { data, error } = await supabase.from(LEADERBOARD_TABLE).insert(row).select().single();
  if (error) {
    console.warn('saveScore failed:', error.message);
    return null;
  }
  return data;
}

export async function fetchTopScores(limit = 20) {
  const { data, error } = await supabase
    .from(LEADERBOARD_TABLE)
    .select('player_name, score, room_code, survival_seconds, players_eliminated, won, created_at')
    .order('score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('fetchTopScores failed:', error.message);
    return [];
  }
  return data ?? [];
}
