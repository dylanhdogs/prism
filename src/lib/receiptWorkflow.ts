import { getCurrentUser } from './auth';
import { logActivity } from './database';
import type {
  Expense,
  ExpenseReceipt,
  GroupMember,
  ReceiptItem,
  ReceiptItemClaim,
  ReceiptPaymentMethod,
  ReceiptPaymentRequest,
} from './database.types';
import { requireGroupOwner } from './groups';
import { getSupabaseClient } from './supabaseClient';

export interface ReceiptWorkspaceMember {
  id: string;
  user_id: string | null;
  display_name: string | null;
  role: string;
  status: string;
}

export interface ReceiptWorkspaceClaim extends ReceiptItemClaim {
  member?: Pick<GroupMember, 'id' | 'display_name' | 'user_id'> | null;
}

export interface ReceiptWorkspaceItem extends ReceiptItem {
  claims: ReceiptWorkspaceClaim[];
}

export interface ReceiptWorkspace {
  expense: Expense & {
    paid_by?: { display_name: string | null } | null;
  };
  receipt: ExpenseReceipt | null;
  items: ReceiptWorkspaceItem[];
  members: ReceiptWorkspaceMember[];
  currentMemberId: string;
  isOwner: boolean;
  ownerMemberId: string;
  paymentMethods: ReceiptPaymentMethod[];
  paymentRequests: ReceiptPaymentRequest[];
}

export interface ReceiptPaymentMethodDraft {
  id?: string;
  method_type: 'paypal' | 'venmo' | 'zelle' | 'cash_app' | 'custom_link';
  display_name: string;
  handle?: string | null;
  payment_url?: string | null;
  instructions?: string | null;
  is_active?: boolean;
  is_default?: boolean;
}

export interface ReceiptItemDraft {
  id?: string;
  name: string;
  description?: string | null;
  quantity?: number;
  unit_price?: number | null;
  subtotal_amount: number;
  owner_notes?: string | null;
  line_number?: number | null;
}

export interface SaveReceiptWorkspaceInput {
  groupId: string;
  expenseId: string;
  merchantName?: string | null;
  subtotalAmount?: number | null;
  taxAmount?: number;
  tipAmount?: number;
  serviceChargeAmount?: number;
  discountAmount?: number;
  totalAmount?: number | null;
  taxAllocationMethod?: string;
  tipAllocationMethod?: string;
  serviceChargeAllocationMethod?: string;
  discountAllocationMethod?: string;
  extractionStatus?: string;
  items: ReceiptItemDraft[];
}

export interface ReceiptMemberSummary {
  memberId: string;
  displayName: string;
  claimedItems: number;
  subtotal: number;
  taxShare: number;
  tipShare: number;
  serviceChargeShare: number;
  discountShare: number;
  totalWithAllocations: number;
}

type WorkspaceRow = Expense & {
  paid_by?: { display_name: string | null } | null;
  receipt?: (ExpenseReceipt & {
    items?: (ReceiptItem & {
      claims?: (ReceiptItemClaim & {
        member?: Pick<GroupMember, 'id' | 'display_name' | 'user_id'> | null;
      })[];
    })[];
  })[] | ExpenseReceipt | null;
};

async function getCurrentGroupMember(groupId: string) {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser();
  if (!user.data) throw new Error('Not authenticated.');

  const { data: membership, error } = await supabase
    .from('group_members')
    .select('id, role')
    .eq('group_id', groupId)
    .eq('user_id', user.data.id)
    .eq('status', 'active')
    .single();

  if (error || !membership) {
    throw new Error('You are not a member of this group.');
  }

  return { user: user.data, membership };
}

export async function getReceiptWorkspace(expenseId: string): Promise<ReceiptWorkspace> {
  const supabase = getSupabaseClient();

  const { data: expense, error } = await supabase
    .from('expenses')
    .select(`
      *,
      paid_by:paid_by_member_id(display_name),
      receipt:expense_receipts(
        *,
        items:receipt_items(
          *,
          claims:receipt_item_claims(
            *,
            member:member_id(id, display_name, user_id)
          )
        )
      )
    `)
    .eq('id', expenseId)
    .single();

  if (error || !expense) throw new Error('Receipt workspace not found.');

  const workspaceExpense = expense as unknown as WorkspaceRow;
  const { membership } = await getCurrentGroupMember(workspaceExpense.group_id);

  const { data: members, error: membersError } = await supabase
    .from('group_members')
    .select('id, user_id, display_name, role, status')
    .eq('group_id', workspaceExpense.group_id)
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  if (membersError) throw new Error(membersError.message);

  const { data: paymentMethods, error: methodsError } = await supabase
    .from('receipt_payment_methods')
    .select('*')
    .eq('group_id', workspaceExpense.group_id)
    .eq('owner_member_id', workspaceExpense.paid_by_member_id)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  if (methodsError) throw new Error(methodsError.message);

  const { data: paymentRequests, error: requestsError } = await supabase
    .from('receipt_payment_requests')
    .select('*')
    .eq('expense_id', workspaceExpense.id)
    .order('created_at', { ascending: true });

  if (requestsError) throw new Error(requestsError.message);

  const receipt = (Array.isArray(workspaceExpense.receipt)
    ? workspaceExpense.receipt[0] || null
    : workspaceExpense.receipt || null) as (ExpenseReceipt & {
      items?: (ReceiptItem & {
        claims?: (ReceiptItemClaim & {
          member?: Pick<GroupMember, 'id' | 'display_name' | 'user_id'> | null;
        })[];
      })[];
    }) | null;
  const items = (receipt?.items || [])
    .filter((item) => item.status !== 'removed')
    .sort((a, b) => {
      const lineA = a.line_number ?? Number.MAX_SAFE_INTEGER;
      const lineB = b.line_number ?? Number.MAX_SAFE_INTEGER;
      return lineA - lineB;
    })
    .map((item) => ({
      ...item,
      claims: (item.claims || []).filter((claim) => claim.status !== 'released'),
    }));

  return {
    expense: {
      ...workspaceExpense,
      paid_by: workspaceExpense.paid_by || null,
    },
    receipt,
    items,
    members: (members || []) as ReceiptWorkspaceMember[],
    currentMemberId: membership.id,
    isOwner: membership.role === 'owner',
    ownerMemberId: workspaceExpense.paid_by_member_id,
    paymentMethods: (paymentMethods || []) as ReceiptPaymentMethod[],
    paymentRequests: (paymentRequests || []) as ReceiptPaymentRequest[],
  };
}

export async function saveReceiptPaymentMethods(groupId: string, drafts: ReceiptPaymentMethodDraft[]) {
  const supabase = getSupabaseClient();
  const { user, membership } = await requireGroupOwner(groupId);
  const cleaned = drafts
    .map((method) => ({
      id: method.id,
      group_id: groupId,
      owner_member_id: membership.id,
      owner_user_id: user.id,
      method_type: method.method_type,
      display_name: method.display_name.trim(),
      handle: method.handle?.trim() || null,
      payment_url: method.payment_url?.trim() || null,
      instructions: method.instructions?.trim() || null,
      is_active: method.is_active !== false,
      is_default: method.is_default === true,
    }))
    .filter((method) => method.display_name);

  if (cleaned.length === 0) {
    const { error } = await supabase
      .from('receipt_payment_methods')
      .delete()
      .eq('group_id', groupId)
      .eq('owner_member_id', membership.id);
    if (error) throw new Error(error.message);
    return;
  }

  const defaultIndex = cleaned.findIndex((method) => method.is_default && method.is_active);
  cleaned.forEach((method, index) => {
    method.is_default = index === defaultIndex;
  });

  const keepIds = cleaned.map((method) => method.id).filter(Boolean);
  const { data: existing, error: existingError } = await supabase
    .from('receipt_payment_methods')
    .select('id')
    .eq('group_id', groupId)
    .eq('owner_member_id', membership.id);
  if (existingError) throw new Error(existingError.message);

  const deleteIds = (existing || []).map((method) => method.id).filter((id) => !keepIds.includes(id));
  if (deleteIds.length) {
    const { error } = await supabase.from('receipt_payment_methods').delete().in('id', deleteIds);
    if (error) throw new Error(error.message);
  }

  const { error: clearDefaultError } = await supabase
    .from('receipt_payment_methods')
    .update({ is_default: false })
    .eq('group_id', groupId)
    .eq('owner_member_id', membership.id);
  if (clearDefaultError) throw new Error(clearDefaultError.message);

  const { error: upsertError } = await supabase
    .from('receipt_payment_methods')
    .upsert(cleaned, { onConflict: 'id' });
  if (upsertError) throw new Error(upsertError.message);

  await logActivity(groupId, user.id, 'receipt_payment_methods_saved', {
    owner_member_id: membership.id,
    method_count: cleaned.length,
  });
}

export async function ensureReceiptPaymentRequests(workspace: ReceiptWorkspace) {
  if (!workspace.isOwner) return;
  const supabase = getSupabaseClient();
  const summaries = buildReceiptMemberSummaries(workspace);
  const { data: splits, error: splitsError } = await supabase
    .from('expense_splits')
    .select('id, member_id')
    .eq('expense_id', workspace.expense.id)
    .neq('member_id', workspace.ownerMemberId);
  if (splitsError) throw new Error(splitsError.message);

  const requests = (splits || []).map((split) => ({
    expense_split_id: split.id,
    expense_id: workspace.expense.id,
    group_id: workspace.expense.group_id,
    from_member_id: split.member_id,
    to_member_id: workspace.ownerMemberId,
    amount_requested: summaries.find((summary) => summary.memberId === split.member_id)?.totalWithAllocations || 0,
  }));
  if (!requests.length) return;

  const { error } = await supabase
    .from('receipt_payment_requests')
    .upsert(requests, { onConflict: 'expense_split_id' });
  if (error) throw new Error(error.message);
}

export async function markReceiptPaymentSent(requestId: string, methodId: string, amountSent?: number | null) {
  const supabase = getSupabaseClient();
  const { data: user } = await getCurrentUser();
  if (!user) throw new Error('Not authenticated.');
  const { data: request, error: requestError } = await supabase
    .from('receipt_payment_requests')
    .select('id, expense_id, group_id, from_member_id, amount_requested')
    .eq('id', requestId)
    .single();
  if (requestError || !request) throw new Error('Payment request not found.');
  const { membership } = await getCurrentGroupMember(request.group_id);
  if (membership.id !== request.from_member_id) throw new Error('You can only update your own payment request.');

  const { error } = await supabase
    .from('receipt_payment_requests')
    .update({
      selected_payment_method_id: methodId,
      status: 'payment_sent',
      amount_sent: amountSent == null || !Number.isFinite(amountSent) ? request.amount_requested : roundMoney(amountSent),
    })
    .eq('id', requestId);
  if (error) throw new Error(error.message);
  await logActivity(request.group_id, user.id, 'receipt_payment_sent', { expense_id: request.expense_id, payment_request_id: requestId });
}

export async function confirmReceiptPayment(requestId: string) {
  const supabase = getSupabaseClient();
  const { data: user } = await getCurrentUser();
  if (!user) throw new Error('Not authenticated.');
  const { data: request, error: requestError } = await supabase
    .from('receipt_payment_requests')
    .select('id, expense_id, group_id, to_member_id, status')
    .eq('id', requestId)
    .single();
  if (requestError || !request) throw new Error('Payment request not found.');
  const { membership } = await getCurrentGroupMember(request.group_id);
  if (membership.id !== request.to_member_id) throw new Error('Only the receipt owner can confirm this payment.');
  if (request.status !== 'payment_sent') throw new Error('Payment must be marked sent before confirmation.');

  const { error } = await supabase
    .from('receipt_payment_requests')
    .update({ status: 'confirmed' })
    .eq('id', requestId);
  if (error) throw new Error(error.message);
  await logActivity(request.group_id, user.id, 'receipt_payment_confirmed', { expense_id: request.expense_id, payment_request_id: requestId });
}

export async function saveReceiptWorkspace(input: SaveReceiptWorkspaceInput) {
  const supabase = getSupabaseClient();
  const { user } = await requireGroupOwner(input.groupId);

  const { data: receipt, error: receiptError } = await supabase
    .from('expense_receipts')
    .select('id, expense_id')
    .eq('expense_id', input.expenseId)
    .single();

  if (receiptError || !receipt) {
    throw new Error('Upload a receipt file before editing receipt items.');
  }

  const cleanedItems = input.items
    .map((item, index) => ({
      id: item.id,
      expense_receipt_id: receipt.id,
      name: item.name.trim(),
      description: item.description?.trim() || null,
      quantity: roundQuantity(item.quantity ?? 1),
      unit_price: item.unit_price == null || !Number.isFinite(item.unit_price) ? null : roundMoney(item.unit_price),
      subtotal_amount: roundMoney(item.subtotal_amount),
      owner_notes: item.owner_notes?.trim() || null,
      line_number: item.line_number ?? index + 1,
      status: 'active',
    }))
    .filter((item) => item.name && item.subtotal_amount >= 0);

  if (cleanedItems.length === 0) {
    throw new Error('Add at least one receipt item.');
  }

  const { error: updateReceiptError } = await supabase
    .from('expense_receipts')
    .update({
      merchant_name: input.merchantName?.trim() || null,
      subtotal_amount: input.subtotalAmount == null || !Number.isFinite(input.subtotalAmount) ? null : roundMoney(input.subtotalAmount),
      tax_amount: roundMoney(input.taxAmount ?? 0),
      tip_amount: roundMoney(input.tipAmount ?? 0),
      service_charge_amount: roundMoney(input.serviceChargeAmount ?? 0),
      discount_amount: roundMoney(input.discountAmount ?? 0),
      total_amount: input.totalAmount == null || !Number.isFinite(input.totalAmount) ? null : roundMoney(input.totalAmount),
      tax_allocation_method: input.taxAllocationMethod || 'proportional_subtotal',
      tip_allocation_method: input.tipAllocationMethod || 'proportional_subtotal',
      service_charge_allocation_method: input.serviceChargeAllocationMethod || 'proportional_subtotal',
      discount_allocation_method: input.discountAllocationMethod || 'proportional_subtotal',
      extraction_status: input.extractionStatus || 'ready',
      corrected_at: new Date().toISOString(),
      corrected_by: user.id,
    })
    .eq('id', receipt.id);

  if (updateReceiptError) throw new Error(updateReceiptError.message);

  const itemIdsToKeep = cleanedItems.map((item) => item.id).filter(Boolean);
  const { data: existingItems, error: existingItemsError } = await supabase
    .from('receipt_items')
    .select('id')
    .eq('expense_receipt_id', receipt.id);
  if (existingItemsError) throw new Error(existingItemsError.message);

  const existingIds = new Set((existingItems || []).map((item) => item.id));
  const deleteIds = Array.from(existingIds).filter((id) => !itemIdsToKeep.includes(id));

  if (deleteIds.length) {
    const { error: deleteError } = await supabase
      .from('receipt_items')
      .delete()
      .in('id', deleteIds);
    if (deleteError) throw new Error(deleteError.message);
  }

  const { error: upsertError } = await supabase
    .from('receipt_items')
    .upsert(cleanedItems, { onConflict: 'id' });

  if (upsertError) throw new Error(upsertError.message);

  await logActivity(input.groupId, user.id, 'receipt_items_saved', {
    expense_id: input.expenseId,
    receipt_id: receipt.id,
    item_count: cleanedItems.length,
  });
}

export async function claimReceiptItem(receiptItemId: string) {
  const supabase = getSupabaseClient();

  const { data: item, error: itemError } = await supabase
    .from('receipt_items')
    .select('id, expense_id, group_id, name')
    .eq('id', receiptItemId)
    .single();

  if (itemError || !item) throw new Error('Receipt item not found.');

  const { user, membership } = await getCurrentGroupMember(item.group_id);

  const { data: existingClaim } = await supabase
    .from('receipt_item_claims')
    .select('id, status')
    .eq('receipt_item_id', receiptItemId)
    .eq('member_id', membership.id)
    .maybeSingle();

  if (existingClaim) {
    const { error } = await supabase
      .from('receipt_item_claims')
      .delete()
      .eq('id', existingClaim.id);
    if (error) throw new Error(error.message);

    await logActivity(item.group_id, user.id, 'receipt_item_unclaimed', {
      expense_id: item.expense_id,
      receipt_item_id: receiptItemId,
      item_name: item.name,
    });
    return { claimed: false };
  }

  const { error: insertError } = await supabase
    .from('receipt_item_claims')
    .insert({
      receipt_item_id: receiptItemId,
      member_id: membership.id,
      claim_quantity: 1,
      status: 'claimed',
    });

  if (insertError) throw new Error(insertError.message);

  await logActivity(item.group_id, user.id, 'receipt_item_claimed', {
    expense_id: item.expense_id,
    receipt_item_id: receiptItemId,
    item_name: item.name,
  });
  return { claimed: true };
}

export function buildReceiptMemberSummaries(workspace: ReceiptWorkspace): ReceiptMemberSummary[] {
  const subtotalByMember = new Map<string, number>();
  const itemCountByMember = new Map<string, number>();
  const activeMembers = workspace.members.filter((member) => member.status === 'active');

  activeMembers.forEach((member) => {
    subtotalByMember.set(member.id, 0);
    itemCountByMember.set(member.id, 0);
  });

  for (const item of workspace.items) {
    const activeClaims = item.claims.filter((claim) => claim.status === 'claimed');
    if (activeClaims.length === 0) continue;

    const perClaimSubtotal = roundMoney(Number(item.subtotal_amount) / activeClaims.length);
    activeClaims.forEach((claim) => {
      subtotalByMember.set(claim.member_id, roundMoney((subtotalByMember.get(claim.member_id) || 0) + perClaimSubtotal));
      itemCountByMember.set(claim.member_id, (itemCountByMember.get(claim.member_id) || 0) + 1);
    });
  }

  const receipt = workspace.receipt;
  const subtotalBase = Array.from(subtotalByMember.values()).reduce((sum, value) => sum + value, 0);
  const participantIds = activeMembers
    .map((member) => member.id)
    .filter((id) => (subtotalByMember.get(id) || 0) > 0);

  return activeMembers.map((member) => {
    const subtotal = roundMoney(subtotalByMember.get(member.id) || 0);
    const taxShare = computeAllocationShare(receipt?.tax_amount || 0, receipt?.tax_allocation_method || 'proportional_subtotal', subtotal, subtotalBase, participantIds.length);
    const tipShare = computeAllocationShare(receipt?.tip_amount || 0, receipt?.tip_allocation_method || 'proportional_subtotal', subtotal, subtotalBase, participantIds.length);
    const serviceChargeShare = computeAllocationShare(receipt?.service_charge_amount || 0, receipt?.service_charge_allocation_method || 'proportional_subtotal', subtotal, subtotalBase, participantIds.length);
    const discountShare = computeAllocationShare(receipt?.discount_amount || 0, receipt?.discount_allocation_method || 'proportional_subtotal', subtotal, subtotalBase, participantIds.length);

    return {
      memberId: member.id,
      displayName: member.display_name || 'Unknown',
      claimedItems: itemCountByMember.get(member.id) || 0,
      subtotal,
      taxShare,
      tipShare,
      serviceChargeShare,
      discountShare,
      totalWithAllocations: roundMoney(subtotal + taxShare + tipShare + serviceChargeShare - discountShare),
    };
  });
}

function computeAllocationShare(
  totalAmount: number,
  method: string,
  memberSubtotal: number,
  subtotalBase: number,
  participantCount: number,
) {
  const amount = roundMoney(totalAmount);
  if (amount <= 0 || memberSubtotal <= 0) return 0;
  if (method === 'equal') {
    if (!participantCount) return 0;
    return roundMoney(amount / participantCount);
  }
  if (!subtotalBase) return 0;
  return roundMoney((memberSubtotal / subtotalBase) * amount);
}

function roundMoney(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}
