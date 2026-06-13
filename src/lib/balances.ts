import { getSupabaseClient } from './supabaseClient';

export interface BalanceSummary {
  memberId: string;
  displayName: string;
  totalPaid: number;
  totalOwed: number;
  netBalance: number;
}

export interface OwedEntry {
  fromMemberId: string;
  fromName: string;
  toMemberId: string;
  toName: string;
  amount: number;
  splitId?: string;
  expenseTitle?: string;
}

export async function calculateGroupBalances(groupId: string): Promise<{
  balances: BalanceSummary[];
  debts: OwedEntry[];
  simplified: OwedEntry[];
}> {
  const supabase = getSupabaseClient();

  const { data: members } = await supabase
    .from('group_members')
    .select('id, display_name')
    .eq('group_id', groupId)
    .eq('status', 'active');

  if (!members || members.length === 0) {
    return { balances: [], debts: [], simplified: [] };
  }

  const { data: expenses } = await supabase
    .from('expenses')
    .select('id, paid_by_member_id, amount, title')
    .eq('group_id', groupId);

  const expenseIds = expenses ? expenses.map((e) => e.id) : [];
  if (expenseIds.length === 0) {
    return {
      balances: members.map((m) => ({
        memberId: m.id,
        displayName: m.display_name ?? 'Unknown',
        totalPaid: 0,
        totalOwed: 0,
        netBalance: 0,
      })),
      debts: [],
      simplified: [],
    };
  }

  const { data: splits } = await supabase
    .from('expense_splits')
    .select('id, expense_id, member_id, amount_owed, is_settled')
    .in('expense_id', expenseIds);

  const memberMap = new Map(members.map((m) => [m.id, m.display_name ?? 'Unknown']));
  const paidMap = new Map<string, number>();
  const owedMap = new Map<string, number>();

  for (const m of members) {
    paidMap.set(m.id, 0);
    owedMap.set(m.id, 0);
  }

  for (const expense of expenses || []) {
    paidMap.set(expense.paid_by_member_id, (paidMap.get(expense.paid_by_member_id) || 0) + Number(expense.amount));
  }

  for (const split of splits || []) {
    if (!split.is_settled) {
      owedMap.set(split.member_id, (owedMap.get(split.member_id) || 0) + Number(split.amount_owed));
    }
  }

  const { data: settlements } = await supabase
    .from('settlements')
    .select('from_member_id, to_member_id, amount')
    .eq('group_id', groupId)
    .eq('status', 'completed');

  for (const s of settlements || []) {
    paidMap.set(s.from_member_id, (paidMap.get(s.from_member_id) || 0) + Number(s.amount));
    owedMap.set(s.to_member_id, (owedMap.get(s.to_member_id) || 0) + Number(s.amount));
  }

  const balances: BalanceSummary[] = members.map((m) => {
    const totalPaid = paidMap.get(m.id) || 0;
    const totalOwed = owedMap.get(m.id) || 0;
    return {
      memberId: m.id,
      displayName: m.display_name ?? 'Unknown',
      totalPaid,
      totalOwed,
      netBalance: Math.round((totalPaid - totalOwed) * 100) / 100,
    };
  });

  const debts: OwedEntry[] = [];
  for (const expense of expenses || []) {
    const payerName = memberMap.get(expense.paid_by_member_id) || 'Unknown';
    for (const split of splits || []) {
      if (split.expense_id === expense.id && !split.is_settled && split.member_id !== expense.paid_by_member_id) {
        debts.push({
          fromMemberId: split.member_id,
          fromName: memberMap.get(split.member_id) || 'Unknown',
          toMemberId: expense.paid_by_member_id,
          toName: payerName,
          amount: Number(split.amount_owed),
          splitId: split.id,
          expenseTitle: expense.title || undefined,
        });
      }
    }
  }

  const simplified = simplifyDebts(balances, memberMap);
  return { balances, debts, simplified };
}

function simplifyDebts(balances: BalanceSummary[], memberMap: Map<string, string>): OwedEntry[] {
  const creditors = balances.filter((b) => b.netBalance > 0).sort((a, b) => b.netBalance - a.netBalance);
  const debtors = balances.filter((b) => b.netBalance < 0).sort((a, b) => a.netBalance - b.netBalance);
  const result: OwedEntry[] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const creditAmount = creditors[ci].netBalance;
    const debtAmount = Math.abs(debtors[di].netBalance);
    const settledAmount = Math.min(creditAmount, debtAmount);

    if (settledAmount > 0.01) {
      result.push({
        fromMemberId: debtors[di].memberId,
        fromName: debtors[di].displayName,
        toMemberId: creditors[ci].memberId,
        toName: creditors[ci].displayName,
        amount: Math.round(settledAmount * 100) / 100,
      });
    }

    creditors[ci].netBalance = Math.round((creditAmount - settledAmount) * 100) / 100;
    debtors[di].netBalance = Math.round((debtors[di].netBalance + settledAmount) * 100) / 100;

    if (creditors[ci].netBalance < 0.01) ci++;
    if (Math.abs(debtors[di].netBalance) < 0.01) di++;
  }

  return result;
}
