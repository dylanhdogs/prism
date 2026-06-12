import { getSupabaseClient } from './supabaseClient';
import { getCurrentUser } from './auth';
import { logActivity } from './database';
import type { Expense, ExpenseSplit, GroupMember } from './database.types';

export interface CreateExpenseInput {
  groupId: string;
  paidByMemberId: string;
  title: string;
  amount: number;
  expenseDate: string;
  splitType?: 'equal' | 'custom';
  description?: string;
  selectedMemberIds: string[];
}

export async function createExpense(input: CreateExpenseInput) {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser();
  if (!user.data) throw new Error('Not authenticated.');

  const { data: expense, error } = await supabase
    .from('expenses')
    .insert({
      group_id: input.groupId,
      paid_by_member_id: input.paidByMemberId,
      title: input.title,
      amount: input.amount,
      expense_date: input.expenseDate,
      split_type: input.splitType ?? 'equal',
      description: input.description ?? null,
      created_by: user.data.id,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  const splits = calculateEqualSplit(input.amount, input.selectedMemberIds);
  await saveExpenseSplits(expense.id, splits);

  await logActivity(input.groupId, user.data.id, 'expense_added', {
    expense_id: expense.id,
    title: input.title,
    amount: input.amount,
  });

  return expense as Expense;
}

export async function getGroupExpenses(groupId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('expenses')
    .select('*, paid_by:paid_by_member_id(display_name), splits:expense_splits(*)')
    .eq('group_id', groupId)
    .order('expense_date', { ascending: false });

  if (error) throw new Error(error.message);
  return data;
}

export async function getExpenseById(expenseId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('expenses')
    .select('*, paid_by:paid_by_member_id(display_name), splits:expense_splits(*)')
    .eq('id', expenseId)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function updateExpense(expenseId: string, updates: Partial<Omit<Expense, 'id' | 'created_at' | 'created_by'>>) {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser();
  if (!user.data) throw new Error('Not authenticated.');

  const { data: expense } = await supabase
    .from('expenses')
    .select('created_by, group_id')
    .eq('id', expenseId)
    .single();

  if (!expense) throw new Error('Expense not found.');
  if (expense.created_by !== user.data.id) {
    const { data: membership } = await supabase
      .from('group_members')
      .select('role')
      .eq('group_id', expense.group_id)
      .eq('user_id', user.data.id)
      .single();
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      throw new Error('You can only edit your own expenses.');
    }
  }

  const { data, error } = await supabase
    .from('expenses')
    .update(updates)
    .eq('id', expenseId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Expense;
}

export async function deleteExpense(expenseId: string) {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser();
  if (!user.data) throw new Error('Not authenticated.');

  const { data: expense } = await supabase
    .from('expenses')
    .select('created_by, group_id')
    .eq('id', expenseId)
    .single();

  if (!expense) throw new Error('Expense not found.');
  if (expense.created_by !== user.data.id) {
    const { data: membership } = await supabase
      .from('group_members')
      .select('role')
      .eq('group_id', expense.group_id)
      .eq('user_id', user.data.id)
      .single();
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      throw new Error('You can only delete your own expenses.');
    }
  }

  await supabase.from('expense_splits').delete().eq('expense_id', expenseId);

  const { error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', expenseId);

  if (error) throw new Error(error.message);
  await logActivity(expense.group_id, user.data.id, 'expense_deleted', { expense_id: expenseId });
}

export function calculateEqualSplit(amount: number, memberIds: string[]): { member_id: string; amount_owed: number }[] {
  if (memberIds.length === 0) return [];
  const perPerson = Math.round((amount / memberIds.length) * 100) / 100;
  const remainder = Math.round((amount - perPerson * memberIds.length) * 100) / 100;

  return memberIds.map((memberId, index) => ({
    member_id: memberId,
    amount_owed: index === 0 ? Math.round((perPerson + remainder) * 100) / 100 : perPerson,
  }));
}

export function calculateCustomSplit(amount: number, customAmounts: { member_id: string; amount: number }[]): { member_id: string; amount_owed: number }[] {
  const totalCustom = customAmounts.reduce((sum, c) => sum + c.amount, 0);
  const remainder = Math.round((amount - totalCustom) * 100) / 100;

  return customAmounts.map((c, i) => ({
    member_id: c.member_id,
    amount_owed: i === 0 ? Math.round((c.amount + remainder) * 100) / 100 : c.amount,
  }));
}

export async function saveExpenseSplits(expenseId: string, splits: { member_id: string; amount_owed: number }[]) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('expense_splits').insert(
    splits.map((s) => ({
      expense_id: expenseId,
      member_id: s.member_id,
      amount_owed: s.amount_owed,
    })),
  );
  if (error) throw new Error(error.message);
}
