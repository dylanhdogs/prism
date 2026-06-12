import { getValidGuestSession, json } from '../../_lib/guest';

export async function onRequestGet(context: any) {
  try {
    const valid = await getValidGuestSession(context.request, context.env);
    if (!valid) return json({ message: 'Guest session expired or invalid.' }, { status: 401 });

    const { supabase, session, groupId } = valid;

    const [groupResult, membersResult, expensesResult, settlementsResult] = await Promise.all([
      supabase.from('groups').select('id, name, description, created_at').eq('id', groupId).single(),
      supabase.from('group_members').select('id, display_name, role, status, user_id').eq('group_id', groupId).eq('status', 'active'),
      supabase
        .from('expenses')
        .select('id, title, description, amount, expense_date, paid_by:paid_by_member_id(id, display_name), splits:expense_splits(id, member_id, amount_owed, is_settled)')
        .eq('group_id', groupId)
        .order('expense_date', { ascending: false }),
      supabase
        .from('settlements')
        .select('id, amount, status, settled_at, from_member:from_member_id(display_name), to_member:to_member_id(display_name)')
        .eq('group_id', groupId)
        .order('created_at', { ascending: false }),
    ]);

    if (groupResult.error || !groupResult.data) {
      return json({ message: 'Unable to load guest group.' }, { status: 404 });
    }

    return json({
      guest: {
        name: session.guest_name,
        expiresAt: session.expires_at,
      },
      group: groupResult.data,
      members: membersResult.data || [],
      expenses: expensesResult.data || [],
      settlements: settlementsResult.data || [],
    });
  } catch (error: any) {
    return json({ message: error.message || 'Unable to load guest group.' }, { status: 500 });
  }
}
