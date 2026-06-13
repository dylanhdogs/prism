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
  splitIds?: string[];
  expenseTitle?: string;
}

type SplitRow = {
  id: string;
  expense_id: string;
  member_id: string;
  amount_owed: number;
  is_settled: boolean;
};

type ExpenseRow = {
  id: string;
  paid_by_member_id: string;
  amount: number;
  title: string;
};

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

  const { data: rawSplits } = await supabase
    .from('expense_splits')
    .select('id, expense_id, member_id, amount_owed, is_settled')
    .in('expense_id', expenseIds);
  const splits = normalizeSplitsForBalance(expenses || [], rawSplits || []);

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
    owedMap.set(split.member_id, (owedMap.get(split.member_id) || 0) + Number(split.amount_owed));
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

  const settlementByPair = new Map<string, number>();
  for (const s of settlements || []) {
    const key = `${s.from_member_id}|${s.to_member_id}`;
    settlementByPair.set(key, (settlementByPair.get(key) || 0) + Number(s.amount));
  }

  // Map split IDs to their expense titles
  const expenseTitleMap = new Map(expenses?.map((e) => [e.id, e.title]) || []);
  const splitsExpTitles = new Map<string, string | undefined>();
  for (const split of splits || []) {
    splitsExpTitles.set(split.id, expenseTitleMap.get(split.expense_id) || undefined);
  }

  // Group unsettled splits by (fromMember, toMember) pair
  const splitGroups = new Map<string, { splits: SplitRow[]; total: number; payerName: string }>();
  for (const expense of expenses || []) {
    const payerName = memberMap.get(expense.paid_by_member_id) || 'Unknown';
    for (const split of splits || []) {
      if (split.expense_id === expense.id && !split.is_settled && split.member_id !== expense.paid_by_member_id) {
        const key = `${split.member_id}|${expense.paid_by_member_id}`;
        let group = splitGroups.get(key);
        if (!group) {
          group = { splits: [], total: 0, payerName };
          splitGroups.set(key, group);
        }
        group.splits.push(split);
        group.total += Number(split.amount_owed);
      }
    }
  }

  const debts: OwedEntry[] = [];
  for (const [key, group] of splitGroups) {
    const [fromMemberId, toMemberId] = key.split('|');
    const settled = settlementByPair.get(key) || 0;
    const netOwed = Math.round((group.total - settled) * 100) / 100;

    if (netOwed <= 0.01) continue;

    const splitTitles = group.splits.map((split) => splitsExpTitles.get(split.id)).filter(Boolean);
    const firstTitle = splitTitles[0];
    const hasOneTitle = splitTitles.length === group.splits.length && splitTitles.every((title) => title === firstTitle);

    debts.push({
      fromMemberId,
      fromName: memberMap.get(fromMemberId) || 'Unknown',
      toMemberId,
      toName: group.payerName,
      amount: netOwed,
      splitId: group.splits.length === 1 && settled === 0 ? group.splits[0].id : undefined,
      splitIds: settled === 0 ? group.splits.map((split) => split.id) : undefined,
      expenseTitle: hasOneTitle ? firstTitle : undefined,
    });
  }

  const simplified = simplifyDebtsFromEntries(debts, memberMap);
  return { balances, debts, simplified };
}

function simplifyDebts(balances: BalanceSummary[], memberMap: Map<string, string>): OwedEntry[] {
  const workingBalances = balances.map((balance) => ({ ...balance }));
  const creditors = workingBalances.filter((b) => b.netBalance > 0).sort((a, b) => b.netBalance - a.netBalance);
  const debtors = workingBalances.filter((b) => b.netBalance < 0).sort((a, b) => a.netBalance - b.netBalance);
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

function simplifyDebtsFromEntries(debts: OwedEntry[], memberMap: Map<string, string>): OwedEntry[] {
  const netByMember = new Map<string, number>();

  for (const debt of debts) {
    netByMember.set(debt.fromMemberId, roundMoney((netByMember.get(debt.fromMemberId) || 0) - debt.amount));
    netByMember.set(debt.toMemberId, roundMoney((netByMember.get(debt.toMemberId) || 0) + debt.amount));
  }

  const balances = Array.from(netByMember, ([memberId, netBalance]) => ({
    memberId,
    displayName: memberMap.get(memberId) || 'Unknown',
    totalPaid: Math.max(0, netBalance),
    totalOwed: Math.max(0, -netBalance),
    netBalance,
  }));

  return simplifyDebts(balances, memberMap);
}

function normalizeSplitsForBalance(expenses: ExpenseRow[], splits: SplitRow[]): SplitRow[] {
  const expenseById = new Map(expenses.map((expense) => [expense.id, expense]));
  const splitsByExpense = new Map<string, SplitRow[]>();

  for (const split of splits) {
    const amount = roundMoney(Number(split.amount_owed));
    if (amount <= 0) continue;

    const normalizedSplit = { ...split, amount_owed: amount };
    const group = splitsByExpense.get(split.expense_id) || [];
    group.push(normalizedSplit);
    splitsByExpense.set(split.expense_id, group);
  }

  const normalized: SplitRow[] = [];
  for (const [expenseId, expenseSplits] of splitsByExpense) {
    const expense = expenseById.get(expenseId);
    if (!expense) continue;

    const expenseAmount = roundMoney(Number(expense.amount));
    if (expenseAmount <= 0) continue;

    const splitTotal = roundMoney(expenseSplits.reduce((sum, split) => sum + Number(split.amount_owed), 0));
    if (splitTotal <= expenseAmount + 0.01) {
      normalized.push(...expenseSplits);
      continue;
    }

    const scale = expenseAmount / splitTotal;
    let runningTotal = 0;
    expenseSplits.forEach((split, index) => {
      const isLast = index === expenseSplits.length - 1;
      const amount = isLast
        ? roundMoney(expenseAmount - runningTotal)
        : roundMoney(Number(split.amount_owed) * scale);
      runningTotal = roundMoney(runningTotal + amount);
      normalized.push({ ...split, amount_owed: Math.max(0, amount) });
    });
  }

  return normalized;
}

function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}
