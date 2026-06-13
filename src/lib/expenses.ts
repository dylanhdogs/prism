import { getSupabaseClient } from './supabaseClient';
import { requireGroupOwner } from './groups';
import { logActivity } from './database';
import type { Expense, ExpenseReceipt } from './database.types';

const RECEIPT_BUCKET = 'receipts';
const MAX_RECEIPT_SIZE_BYTES = 10 * 1024 * 1024;
const RECEIPT_SIGNED_URL_SECONDS = 5 * 60;
const RECEIPT_TYPES = ['application/pdf'];

export interface CreateExpenseInput {
  groupId: string;
  paidByMemberId: string;
  title: string;
  amount: number;
  expenseDate: string;
  splitType?: 'equal' | 'custom';
  description?: string;
  selectedMemberIds: string[];
  customAmounts?: { member_id: string; amount: number | null }[];
  receiptFile?: File | null;
}

export interface UpdateExpenseInput extends CreateExpenseInput {
  expenseId: string;
  removeReceipt?: boolean;
}

export async function createExpense(input: CreateExpenseInput) {
  const supabase = getSupabaseClient();
  const { user } = await requireGroupOwner(input.groupId);

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
      created_by: user.id,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  const splits = buildExpenseSplits(input);
  await saveExpenseSplits(expense.id, splits);

  try {
    if (input.receiptFile) {
      await replaceExpenseReceipt(expense.id, input.groupId, input.receiptFile);
    }

    await logActivity(input.groupId, user.id, 'expense_added', {
      expense_id: expense.id,
      title: input.title,
      amount: input.amount,
    });
  } catch (err) {
    await supabase.from('expense_splits').delete().eq('expense_id', expense.id);
    await supabase.from('expenses').delete().eq('id', expense.id);
    throw err;
  }

  return expense as Expense;
}

export async function updateExpense(input: UpdateExpenseInput) {
  const supabase = getSupabaseClient();
  const { user } = await requireGroupOwner(input.groupId);

  const { data: existingExpense, error: fetchError } = await supabase
    .from('expenses')
    .select('id, group_id')
    .eq('id', input.expenseId)
    .eq('group_id', input.groupId)
    .single();

  if (fetchError || !existingExpense) {
    throw new Error('Expense not found.');
  }

  const { data: expense, error } = await supabase
    .from('expenses')
    .update({
      paid_by_member_id: input.paidByMemberId,
      title: input.title,
      amount: input.amount,
      expense_date: input.expenseDate,
      split_type: input.splitType ?? 'equal',
      description: input.description ?? null,
    })
    .eq('id', input.expenseId)
    .select()
    .single();

  if (error) throw new Error(error.message);

  await supabase.from('expense_splits').delete().eq('expense_id', input.expenseId);
  const splits = buildExpenseSplits(input);
  await saveExpenseSplits(input.expenseId, splits);

  if (input.removeReceipt) {
    await removeExpenseReceipt(input.expenseId);
  }

  if (input.receiptFile) {
    await replaceExpenseReceipt(input.expenseId, input.groupId, input.receiptFile);
  }

  await logActivity(input.groupId, user.id, 'expense_updated', {
    expense_id: input.expenseId,
    title: input.title,
    amount: input.amount,
  });

  return expense as Expense;
}

export async function getGroupExpenses(groupId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('expenses')
    .select('*, paid_by:paid_by_member_id(display_name), splits:expense_splits(*), receipt:expense_receipts(*)')
    .eq('group_id', groupId)
    .order('expense_date', { ascending: false });

  if (error) throw new Error(error.message);
  return data;
}

export async function getExpenseById(expenseId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('expenses')
    .select('*, paid_by:paid_by_member_id(display_name), splits:expense_splits(*), receipt:expense_receipts(*)')
    .eq('id', expenseId)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function deleteExpense(expenseId: string) {
  const supabase = getSupabaseClient();
  const { data: expense, error: fetchError } = await supabase
    .from('expenses')
    .select('group_id')
    .eq('id', expenseId)
    .single();

  if (fetchError || !expense) throw new Error('Expense not found.');
  const { user } = await requireGroupOwner(expense.group_id);

  const { data: receipt } = await supabase
    .from('expense_receipts')
    .select('file_path')
    .eq('expense_id', expenseId)
    .maybeSingle();

  await supabase.from('expense_splits').delete().eq('expense_id', expenseId);

  const { error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', expenseId);

  if (error) throw new Error(error.message);
  if (receipt?.file_path) {
    await supabase.storage.from(RECEIPT_BUCKET).remove([receipt.file_path]);
  }
  await logActivity(expense.group_id, user.id, 'expense_deleted', { expense_id: expenseId });
}

export async function replaceExpenseReceipt(expenseId: string, groupId: string, file: File) {
  validateReceiptFile(file);

  const supabase = getSupabaseClient();
  const { user } = await requireGroupOwner(groupId);
  const { data: existingReceipt } = await supabase
    .from('expense_receipts')
    .select('file_path')
    .eq('expense_id', expenseId)
    .maybeSingle();

  const filePath = `${groupId}/${expenseId}/${crypto.randomUUID()}-${sanitizeReceiptFileName(file.name)}`;
  const { error: uploadError } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(filePath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) throw new Error(uploadError.message);

  const { data, error } = await supabase
    .from('expense_receipts')
    .upsert({
      expense_id: expenseId,
      group_id: groupId,
      file_path: filePath,
      file_name: file.name,
      file_type: file.type,
      file_size: file.size,
      uploaded_by: user.id,
    }, { onConflict: 'expense_id' })
    .select()
    .single();

  if (error) {
    await supabase.storage.from(RECEIPT_BUCKET).remove([filePath]);
    throw new Error(error.message);
  }

  if (existingReceipt?.file_path && existingReceipt.file_path !== filePath) {
    await supabase.storage.from(RECEIPT_BUCKET).remove([existingReceipt.file_path]);
  }

  await logActivity(groupId, user.id, 'receipt_uploaded', { expense_id: expenseId });
  return data as ExpenseReceipt;
}

export async function removeExpenseReceipt(expenseId: string) {
  const supabase = getSupabaseClient();
  const { data: receipt, error: receiptError } = await supabase
    .from('expense_receipts')
    .select('id, group_id, file_path')
    .eq('expense_id', expenseId)
    .maybeSingle();

  if (receiptError) throw new Error(receiptError.message);
  if (!receipt) return;

  const { user } = await requireGroupOwner(receipt.group_id);
  const { error } = await supabase
    .from('expense_receipts')
    .delete()
    .eq('id', receipt.id);

  if (error) throw new Error(error.message);

  await supabase.storage.from(RECEIPT_BUCKET).remove([receipt.file_path]);
  await logActivity(receipt.group_id, user.id, 'receipt_removed', { expense_id: expenseId });
}

export async function getReceiptViewUrl(receipt: ExpenseReceipt) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrl(receipt.file_path, RECEIPT_SIGNED_URL_SECONDS);

  if (error || !data?.signedUrl) {
    throw new Error('Unable to open receipt.');
  }

  return data.signedUrl;
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

function buildExpenseSplits(input: CreateExpenseInput): { member_id: string; amount_owed: number }[] {
  if (input.splitType === 'custom') {
    if (!input.customAmounts || input.customAmounts.length === 0) {
      throw new Error('Add custom amounts for each selected person.');
    }

    const blankEntries = input.customAmounts.filter((entry) => entry.amount === null || !Number.isFinite(entry.amount));
    if (blankEntries.length > 1) {
      throw new Error('Leave only one amount blank so Prism can fill the rest.');
    }

    if (blankEntries.length === 1) {
      const remainder = roundMoney(input.amount - input.customAmounts.reduce((sum, entry) => {
        if (entry.amount === null || !Number.isFinite(entry.amount)) return sum;
        return sum + Number(entry.amount);
      }, 0));

      if (remainder < 0) {
        throw new Error('The amounts you entered are more than the expense total.');
      }

      return input.customAmounts.map((entry) => {
        if (entry.amount === null || !Number.isFinite(entry.amount)) {
          return { member_id: entry.member_id, amount_owed: remainder };
        }
        return { member_id: entry.member_id, amount_owed: roundMoney(Number(entry.amount)) };
      });
    }

    return calculateCustomSplit(input.amount, input.customAmounts.map((entry) => ({
      member_id: entry.member_id,
      amount: Number(entry.amount ?? 0),
    })));
  }

  return calculateEqualSplit(input.amount, input.selectedMemberIds);
}

function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function validateReceiptFile(file: File) {
  const isImage = file.type.startsWith('image/');
  const isPdf = RECEIPT_TYPES.includes(file.type);

  if (!isImage && !isPdf) {
    throw new Error('Upload an image or PDF receipt.');
  }

  if (file.size > MAX_RECEIPT_SIZE_BYTES) {
    throw new Error('Receipt file is too large. Keep it under 10 MB.');
  }
}

function sanitizeReceiptFileName(fileName: string) {
  const cleanName = fileName.trim().replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-');
  return cleanName || 'receipt';
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
