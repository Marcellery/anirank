import { supabase } from '@services/supabase';
import type { Database } from '@app-types/database';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];

export async function getProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) throw error;
  return data;
}

export async function updateProfile(userId: string, fields: ProfileUpdate): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update(fields)
    .eq('id', userId);

  if (error) throw error;
}

export async function searchProfiles(
  query: string,
  currentUserId: string,
): Promise<ProfileRow[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .ilike('username', `${query}%`)
    .neq('id', currentUserId)
    .limit(20);

  if (error) throw error;
  return data ?? [];
}
