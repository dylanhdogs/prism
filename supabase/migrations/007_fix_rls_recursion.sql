-- 007_fix_rls_recursion.sql
-- Fixes infinite recursion in group_members RLS policies by using
-- SECURITY DEFINER functions that bypass RLS for membership checks.

-- ── Helper: check if the current user is an active group member ──
CREATE OR REPLACE FUNCTION public.is_group_member(group_id UUID)
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
  );
$$;

-- ── Helper: check if the current user is an owner or admin ──
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
      AND group_members.role IN ('owner', 'admin')
  );
$$;

-- ── Fix group_members SELECT policy ──
DROP POLICY IF EXISTS "Members can view group members" ON public.group_members;
CREATE POLICY "Members can view group members"
  ON public.group_members
  FOR SELECT
  USING (public.is_group_member(group_id));

-- ── Fix group_members INSERT policy ──
DROP POLICY IF EXISTS "Members can join via invite" ON public.group_members;
CREATE POLICY "Members can join via invite"
  ON public.group_members
  FOR INSERT
  WITH CHECK (true);

-- ── Fix group_members UPDATE policy ──
DROP POLICY IF EXISTS "Group owners can update members" ON public.group_members;
CREATE POLICY "Group owners can update members"
  ON public.group_members
  FOR UPDATE
  USING (public.is_group_admin(group_id));

-- ── Fix group_members DELETE policy ──
DROP POLICY IF EXISTS "Group owners can remove members" ON public.group_members;
CREATE POLICY "Group owners can remove members"
  ON public.group_members
  FOR DELETE
  USING (public.is_group_admin(group_id));

-- ── Fix groups SELECT policy: allow creator to see own group ──
DROP POLICY IF EXISTS "Users can view groups they belong to" ON public.groups;
CREATE POLICY "Users can view groups they belong to"
  ON public.groups
  FOR SELECT
  USING (
    created_by = auth.uid()
    OR public.is_group_member(id)
  );
