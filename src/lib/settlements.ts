import { getSupabaseClient } from './supabaseClient';
import { logActivity } from './database';
import type { Settlement } from './database.types';

export async function markSettlementPaid(
  groupId: string,
  fromMemberId: string,
  toMemberId: string,
  amount: number,
) {
  const supabase = getSupabaseClient();
  const user = await import('./auth').then((m) => m.getCurrentUser());
  if (!user.data) throw new Error('Not authenticated.');

  const { data, error } = await supabase
    .from('settlements')
    .insert({
      group_id: groupId,
      from_member_id: fromMemberId,
      to_member_id: toMemberId,
      amount,
      status: 'completed',
      settled_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  await logActivity(groupId, user.data.id, 'settlement_completed', {
    from_member_id: fromMemberId,
    to_member_id: toMemberId,
    amount,
  });

  return data as Settlement;
}

export async function getGroupSettlements(groupId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('settlements')
    .select('*, from_member:from_member_id(display_name), to_member:to_member_id(display_name)')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data;
}

export async function markSplitSettled(splitId: string) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('expense_splits')
    .update({ is_settled: true, updated_at: new Date().toISOString() })
    .eq('id', splitId);

  if (error) throw new Error(error.message);
}
