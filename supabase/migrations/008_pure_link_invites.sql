-- 008_pure_link_invites.sql
-- Convert invitations from email-based to pure link-based.
-- Anyone with the token link can accept the invite.

-- Make invited_email optional (no longer required for link-based invites)
ALTER TABLE public.invitations ALTER COLUMN invited_email DROP NOT NULL;

-- Drop old email-based RLS policies
DROP POLICY IF EXISTS "Members can view invitations for their groups" ON public.invitations;
DROP POLICY IF EXISTS "Members can create invitations" ON public.invitations;
DROP POLICY IF EXISTS "Invited user or group owners can update" ON public.invitations;

-- Keep direct table access restricted to group admins. Token-based public access happens
-- through SECURITY DEFINER RPC functions below, so users cannot enumerate all invites.
CREATE POLICY "Group admins can view invitations"
  ON public.invitations FOR SELECT
  USING (public.is_group_admin(group_id));

CREATE POLICY "Members can create invitations"
  ON public.invitations FOR INSERT
  WITH CHECK (public.is_group_admin(group_id));

CREATE POLICY "Group admins can update invitations"
  ON public.invitations FOR UPDATE
  USING (public.is_group_admin(group_id));

CREATE OR REPLACE FUNCTION public.get_invite_by_token(invite_token TEXT)
RETURNS TABLE (
  id UUID,
  group_id UUID,
  token TEXT,
  status TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  group_name TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    invitations.id,
    invitations.group_id,
    invitations.token,
    invitations.status,
    invitations.expires_at,
    invitations.created_at,
    groups.name AS group_name
  FROM public.invitations
  JOIN public.groups ON groups.id = invitations.group_id
  WHERE invitations.token = invite_token
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.accept_invite_by_token(invite_token TEXT)
RETURNS TABLE (group_id UUID, already_member BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.invitations%ROWTYPE;
  v_user_id UUID := auth.uid();
  v_email TEXT := auth.email();
  v_existing_member public.group_members%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be logged in to accept an invite.';
  END IF;

  SELECT * INTO v_invite
  FROM public.invitations
  WHERE token = invite_token
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found or invalid.';
  END IF;

  IF v_invite.status <> 'pending' THEN
    RAISE EXCEPTION 'This invite has already been used.';
  END IF;

  IF v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'This invite has expired.';
  END IF;

  SELECT * INTO v_existing_member
  FROM public.group_members
  WHERE group_members.group_id = v_invite.group_id
    AND group_members.user_id = v_user_id
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.group_members
    SET status = 'active'
    WHERE id = v_existing_member.id;

    UPDATE public.invitations
    SET status = 'accepted'
    WHERE id = v_invite.id;

    RETURN QUERY SELECT v_invite.group_id, true;
    RETURN;
  END IF;

  INSERT INTO public.group_members (group_id, user_id, display_name, role, status)
  VALUES (
    v_invite.group_id,
    v_user_id,
    COALESCE(NULLIF(split_part(v_email, '@', 1), ''), 'Member'),
    'member',
    'active'
  );

  UPDATE public.invitations
  SET status = 'accepted'
  WHERE id = v_invite.id;

  RETURN QUERY SELECT v_invite.group_id, false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_invite_by_token(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invite_by_token(TEXT) TO authenticated;
