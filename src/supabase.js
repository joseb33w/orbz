import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const TABLE_PREFIX = import.meta.env.VITE_TABLE_PREFIX;

if (!url || !anonKey || !TABLE_PREFIX) {
  console.error('Missing Supabase config. Check .env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_TABLE_PREFIX).');
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false },
  realtime: {
    params: { eventsPerSecond: 30 },
  },
});

export const LEADERBOARD_TABLE = `${TABLE_PREFIX}_leaderboard`;
