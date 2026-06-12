import { getSupabaseClient } from './supabaseClient';
import { logActivity } from './database';
import type { Settlement } from './database.types';

async function requireSettlementAccess(groupId: string, memberIds: string[]) {
  const supabase = getSupabaseClient();
  const user = await import('./auth').then((m) => m.getCurrentUser());
  if (!user.data) throw new Error('Not authenticated.');

  const { data: membership, error } = await supabase
    .from('group_members')
    .select('id, role')
    .eq('group_id', groupId)
    .eq('user_id', user.data.id)
    .eq('status', 'active')
    .single();

  if (error || !membership) throw new Error('Not authenticated.');

  const isAdmin = ['owner', 'admin'].includes(membership.role);
  const isInvolved = memberIds.includes(membership.id);
  if (!isAdmin && !isInvolved) {
    throw new Error('Only the people involved, owners, or admins can record this payment.');
  }

  return user.data;
}

export async function markSettlementPaid(
  groupId: string,
  fromMemberId: string,
  toMemberId: string,
  amount: number,
) {
  const supabase = getSupabaseClient();
  const user = await requireSettlementAccess(groupId, [fromMemberId, toMemberId]);

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

  await logActivity(groupId, user.id, 'settlement_completed', {
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
  const { data: split, error: splitError } = await supabase
    .from('expense_splits')
    .select('member_id, expenses:expense_id(group_id)')
    .eq('id', splitId)
    .single();

  if (splitError || !split) throw new Error('Split not found.');
  const expense = split.expenses as unknown as { group_id: string };
  await requireSettlementAccess(expense.group_id, [split.member_id]);

  const { error } = await supabase
    .from('expense_splits')
    .update({ is_settled: true, updated_at: new Date().toISOString() })
    .eq('id', splitId);

  if (error) throw new Error(error.message);
}
