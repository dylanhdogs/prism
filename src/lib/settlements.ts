import { getSupabaseClient } from './supabaseClient';
import { getCurrentUser } from './auth';
import { logActivity } from './database';
import type { Settlement } from './database.types';

async function getCurrentMember(groupId: string) {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser();
  if (!user.data) throw new Error('Not authenticated.');
  const { data: membership } = await supabase
    .from('group_members')
    .select('id, role')
    .eq('group_id', groupId)
    .eq('user_id', user.data.id)
    .eq('status', 'active')
    .single();
  if (!membership) throw new Error('You are not a member of this group.');
  return { user: user.data, membership };
}

export async function markSettlementPaid(
  groupId: string,
  fromMemberId: string,
  toMemberId: string,
  amount: number,
) {
  const supabase = getSupabaseClient();
  const { user, membership } = await getCurrentMember(groupId);

  if (membership.role !== 'owner' && membership.id !== fromMemberId) {
    throw new Error('Only the group owner or the person making the payment can record a settlement.');
  }

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
  const user = await getCurrentUser();
  if (!user.data) throw new Error('Not authenticated.');

  const { data: split, error: splitError } = await supabase
    .from('expense_splits')
    .select('member_id, expenses:expense_id(group_id)')
    .eq('id', splitId)
    .single();

  if (splitError || !split) throw new Error('Split not found.');
  const groupId = (split.expenses as unknown as { group_id: string }).group_id;

  const { data: membership } = await supabase
    .from('group_members')
    .select('id, role')
    .eq('group_id', groupId)
    .eq('user_id', user.data.id)
    .eq('status', 'active')
    .single();

  if (!membership) throw new Error('You are not a member of this group.');
  if (membership.role !== 'owner' && membership.id !== split.member_id) {
    throw new Error('Only the group owner or the person who owes can mark a split as paid.');
  }

  const { error } = await supabase
    .from('expense_splits')
    .update({ is_settled: true, updated_at: new Date().toISOString() })
    .eq('id', splitId);

  if (error) throw new Error(error.message);
  await logActivity(groupId, user.data.id, 'split_settled', { split_id: splitId });
}

export async function paySplits(
  groupId: string,
  splits: { splitId: string; fromMemberId: string; toMemberId: string; amount: number }[],
  paymentMethod: string,
) {
  if (!splits.length) throw new Error('No splits selected.');
  const supabase = getSupabaseClient();
  const { user, membership } = await getCurrentMember(groupId);

  const now = new Date().toISOString();

  for (const split of splits) {
    if (membership.role !== 'owner' && membership.id !== split.fromMemberId) {
      throw new Error('You can only pay your own debts.');
    }
    const { error: markError } = await supabase
      .from('expense_splits')
      .update({ is_settled: true, updated_at: now })
      .eq('id', split.splitId);
    if (markError) throw new Error(markError.message);
  }

  const byPair = new Map<string, { from: string; to: string; total: number }>();
  for (const s of splits) {
    const key = `${s.fromMemberId}|${s.toMemberId}`;
    let pair = byPair.get(key);
    if (!pair) {
      pair = { from: s.fromMemberId, to: s.toMemberId, total: 0 };
      byPair.set(key, pair);
    }
    pair.total += s.amount;
  }

  for (const [, pair] of byPair) {
    const { error: insertError } = await supabase.from('settlements').insert({
      group_id: groupId,
      from_member_id: pair.from,
      to_member_id: pair.to,
      amount: Math.round(pair.total * 100) / 100,
      status: 'completed',
      settled_at: now,
    });
    if (insertError) throw new Error(insertError.message);
  }

  await logActivity(groupId, user.id, 'bulk_payment', {
    split_ids: splits.map((s) => s.splitId),
    payment_method: paymentMethod,
    total_amount: Math.round(splits.reduce((sum, s) => sum + s.amount, 0) * 100) / 100,
    payee_ids: Array.from(new Set(Array.from(byPair.values()).map((pair) => pair.to))),
  });
}
