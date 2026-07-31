import { getCurrentUser } from './auth';
import type { PayoutProfile } from './database.types';
import { getSupabaseClient } from './supabaseClient';

export type PayoutProfileInput = Pick<PayoutProfile, 'method_type' | 'display_name' | 'account_label' | 'masked_account' | 'instructions'>;

export async function getPayoutProfile() {
  const supabase = getSupabaseClient();
  const { data: user } = await getCurrentUser();
  if (!user) throw new Error('Not authenticated.');

  const { data, error } = await supabase
    .from('payout_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as PayoutProfile | null;
}

export async function savePayoutProfile(input: PayoutProfileInput) {
  const supabase = getSupabaseClient();
  const { data: user } = await getCurrentUser();
  if (!user) throw new Error('Not authenticated.');

  const { data, error } = await supabase
    .from('payout_profiles')
    .upsert({
      user_id: user.id,
      method_type: input.method_type,
      display_name: input.display_name.trim() || 'My receiving account',
      account_label: input.account_label?.trim() || null,
      masked_account: input.masked_account?.trim() || null,
      instructions: input.instructions?.trim() || null,
      status: 'manual',
    }, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as PayoutProfile;
}
