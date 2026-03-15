import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Database } from '@app-types/database';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables.\n' +
      'Copy .env.example to .env and fill in your project values.',
  );
}

/**
 * SecureStore adapter for @supabase/supabase-js.
 *
 * Supabase expects a storage object with getItem / setItem / removeItem.
 * expo-secure-store keys must be ≤ 255 chars and cannot contain dots,
 * so we base64-encode the key to sanitise it.
 */
const secureStoreAdapter = {
  getItem: (key: string) =>
    SecureStore.getItemAsync(sanitiseKey(key)),

  setItem: (key: string, value: string) =>
    SecureStore.setItemAsync(sanitiseKey(key), value),

  removeItem: (key: string) =>
    SecureStore.deleteItemAsync(sanitiseKey(key)),
};

function sanitiseKey(key: string): string {
  // Replace characters that SecureStore forbids; keep it under 255 chars
  return key.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255);
}

/**
 * Single Supabase client instance for the entire app.
 *
 * Feature-specific query functions live inside each feature folder:
 *   src/features/<feature>/<feature>.service.ts
 * Only cross-feature helpers belong in src/services/.
 */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
