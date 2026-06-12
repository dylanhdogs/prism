-- 011_security_hardening.sql
-- Tighten member, invite, settlement, and split update permissions.

-- Members should not be able to add people directly. New members join through
-- invite RPCs, while owners/admins can add non-owner members from the app.
DROP POLICY IF EXISTS "Members can join via invite" ON public.group_members;
DROP POLICY IF EXISTS "Group creators can add owner membership" ON public.group_members;
DROP POLICY IF EXISTS "Group admins can add members" ON public.group_members;

CREATE POLICY "Group creators can add owner membership"
  ON public.group_members
  FOR INSERT
  WITH CHECK (
    role = 'owner'
    AND status = 'active'
    AND user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.groups
      WHERE groups.id = group_members.group_id
        AND groups.created_by = auth.uid()
    )
  );

CREATE POLICY "Group admins can add members"
  ON public.group_members
  FOR INSERT
  WITH CHECK (
    public.is_group_admin(group_id)
    AND role IN ('admin', 'member')
  );

DROP POLICY IF EXISTS "Group owners can update members" ON public.group_members;
CREATE POLICY "Group owners can update members"
  ON public.group_members
  FOR UPDATE
  USING (public.is_group_admin(group_id))
  WITH CHECK (public.is_group_admin(group_id));

-- Settlement records affect balances, so only the people involved or a group
-- owner/admin should be able to create or change them.
DROP POLICY IF EXISTS "Members can create settlements" ON public.settlements;
DROP POLICY IF EXISTS "Members can update settlements in their groups" ON public.settlements;

CREATE POLICY "Involved members or admins can create settlements"
  ON public.settlements
  FOR INSERT
  WITH CHECK (
    public.is_group_admin(group_id)
    OR EXISTS (
      SELECT 1
      FROM public.group_members
      WHERE group_members.group_id = settlements.group_id
        AND group_members.user_id = auth.uid()
        AND group_members.status = 'active'
        AND group_members.id IN (settlements.from_member_id, settlements.to_member_id)
    )
  );

CREATE POLICY "Involved members or admins can update settlements"
  ON public.settlements
  FOR UPDATE
  USING (
    public.is_group_admin(group_id)
    OR EXISTS (
      SELECT 1
      FROM public.group_members
      WHERE group_members.group_id = settlements.group_id
        AND group_members.user_id = auth.uid()
        AND group_members.status = 'active'
        AND group_members.id IN (settlements.from_member_id, settlements.to_member_id)
    )
  )
  WITH CHECK (
    public.is_group_admin(group_id)
    OR EXISTS (
      SELECT 1
      FROM public.group_members
      WHERE group_members.group_id = settlements.group_id
        AND group_members.user_id = auth.uid()
        AND group_members.status = 'active'
        AND group_members.id IN (settlements.from_member_id, settlements.to_member_id)
    )
  );

DROP POLICY IF EXISTS "Members can update splits" ON public.expense_splits;
CREATE POLICY "Involved members or admins can update splits"
  ON public.expense_splits
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.expenses
      WHERE expenses.id = expense_splits.expense_id
        AND (
          public.is_group_admin(expenses.group_id)
          OR EXISTS (
            SELECT 1
            FROM public.group_members
            WHERE group_members.id = expense_splits.member_id
              AND group_members.user_id = auth.uid()
              AND group_members.status = 'active'
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.expenses
      WHERE expenses.id = expense_splits.expense_id
        AND (
          public.is_group_admin(expenses.group_id)
          OR EXISTS (
            SELECT 1
            FROM public.group_members
            WHERE group_members.id = expense_splits.member_id
              AND group_members.user_id = auth.uid()
              AND group_members.status = 'active'
          )
        )
    )
  );
