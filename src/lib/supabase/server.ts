import { createClient } from '@supabase/supabase-js';

export function hasSupabaseConfig() {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const shouldRequireSupabase =
    process.env.YOKOAGENT_REQUIRE_SUPABASE === 'true' ||
    process.env.VERCEL_ENV === 'production';
  if (!configured && shouldRequireSupabase) {
    throw new Error('Supabase environment variables are required for deployed multi-user YokoAgent.');
  }
  return configured;
}

/**
 * Create a Supabase client with service-role key.
 * ONLY use this server-side (API routes, middleware).
 * Never expose the service-role key to the client.
 */
export function createServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
