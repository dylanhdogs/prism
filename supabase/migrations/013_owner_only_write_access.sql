-- 013_owner_only_write_access.sql
-- Restrict all write actions to the group owner only.

-- Keep the legacy function name for compatibility with existing policies.
-- From this migration forward, it returns true only for the group owner.
CREATE OR REPLACE FUNCTION public.is_group_admin(group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_members.group_id = $1
      AND group_members.user_id = auth.uid()
      AND group_members.status = 'active'
      AND group_members.role = 'owner'
  );
$$;

DROP POLICY IF EXISTS "Group owners can update their groups" ON public.groups;
CREATE POLICY "Group owners can update their groups"
  ON public.groups
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_members.group_id = groups.id
        AND group_members.user_id = auth.uid()
        AND group_members.role = 'owner'
        AND group_members.status = 'active'
    )
  );

DROP POLICY IF EXISTS "Group owners can delete their groups" ON public.groups;
CREATE POLICY "Group owners can delete their groups"
  ON public.groups
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_members.group_id = groups.id
        AND group_members.user_id = auth.uid()
        AND group_members.role = 'owner'
        AND group_members.status = 'active'
    )
  );

DROP POLICY IF EXISTS "Group creators can add owner membership" ON public.group_members;
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

DROP POLICY IF EXISTS "Group admins can add members" ON public.group_members;
CREATE POLICY "Group owners can add members"
  ON public.group_members
  FOR INSERT
  WITH CHECK (
    public.is_group_admin(group_id)
    AND role = 'member'
  );

DROP POLICY IF EXISTS "Group owners can update members" ON public.group_members;
CREATE POLICY "Group owners can update members"
  ON public.group_members
  FOR UPDATE
  USING (public.is_group_admin(group_id))
  WITH CHECK (public.is_group_admin(group_id));

DROP POLICY IF EXISTS "Group owners can remove members" ON public.group_members;
CREATE POLICY "Group owners can remove members"
  ON public.group_members
  FOR DELETE
  USING (public.is_group_admin(group_id));

DROP POLICY IF EXISTS "Group admins can view invitations" ON public.invitations;
CREATE POLICY "Group owners can view invitations"
  ON public.invitations
  FOR SELECT
  USING (public.is_group_admin(group_id));

DROP POLICY IF EXISTS "Group admins can update invitations" ON public.invitations;
CREATE POLICY "Group owners can update invitations"
  ON public.invitations
  FOR UPDATE
  USING (public.is_group_admin(group_id));

DROP POLICY IF EXISTS "Members can create expenses in their groups" ON public.expenses;
CREATE POLICY "Group owners can create expenses"
  ON public.expenses
  FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND public.is_group_admin(group_id)
  );

DROP POLICY IF EXISTS "Expense creators or admins can update" ON public.expenses;
CREATE POLICY "Group owners can update expenses"
  ON public.expenses
  FOR UPDATE
  USING (public.is_group_admin(group_id))
  WITH CHECK (public.is_group_admin(group_id));

DROP POLICY IF EXISTS "Expense creators or admins can delete" ON public.expenses;
CREATE POLICY "Group owners can delete expenses"
  ON public.expenses
  FOR DELETE
  USING (public.is_group_admin(group_id));

DROP POLICY IF EXISTS "Members can create splits" ON public.expense_splits;
CREATE POLICY "Group owners can create splits"
  ON public.expense_splits
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE expenses.id = expense_splits.expense_id
        AND public.is_group_admin(expenses.group_id)
    )
  );

DROP POLICY IF EXISTS "Members can update splits" ON public.expense_splits;
CREATE POLICY "Group owners can update splits"
  ON public.expense_splits
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE expenses.id = expense_splits.expense_id
        AND public.is_group_admin(expenses.group_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses
      WHERE expenses.id = expense_splits.expense_id
        AND public.is_group_admin(expenses.group_id)
    )
  );

DROP POLICY IF EXISTS "Members can create settlements" ON public.settlements;
CREATE POLICY "Group owners can create settlements"
  ON public.settlements
  FOR INSERT
  WITH CHECK (public.is_group_admin(group_id));

DROP POLICY IF EXISTS "Members can update settlements in their groups" ON public.settlements;
CREATE POLICY "Group owners can update settlements"
  ON public.settlements
  FOR UPDATE
  USING (public.is_group_admin(group_id))
  WITH CHECK (public.is_group_admin(group_id));
