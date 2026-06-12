import { getSupabaseClient } from './supabaseClient';
import type { Profile } from './database.types';

export async function getProfile(userId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw new Error(error.message);
  return data as Profile;
}

export async function updateProfile(userId: string, updates: Partial<Pick<Profile, 'full_name' | 'avatar_url'>>) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Profile;
}

export async function ensureProfile(userId: string, email: string, fullName?: string) {
  const supabase = getSupabaseClient();
  const existing = await supabase.from('profiles').select('id').eq('id', userId).single();
  if (existing.data) return existing.data as Profile;

  const { data, error } = await supabase
    .from('profiles')
    .insert({ id: userId, email, full_name: fullName || email.split('@')[0] })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Profile;
}

export async function logActivity(groupId: string, userId: string, action: string, metadata?: Record<string, unknown>) {
  const supabase = getSupabaseClient();
  await supabase.from('activity_logs').insert({
    group_id: groupId,
    user_id: userId,
    action,
    metadata: metadata ?? null,
  });
}
