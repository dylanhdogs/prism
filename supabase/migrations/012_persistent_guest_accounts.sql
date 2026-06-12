-- 012_persistent_guest_accounts.sql
-- Makes browser guest access durable and adds guests as group members.

ALTER TABLE public.guest_sessions
  ADD COLUMN IF NOT EXISTS group_member_id UUID REFERENCES public.group_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_guest_sessions_group_member_id ON public.guest_sessions(group_member_id);

CREATE OR REPLACE FUNCTION public.open_guest_invite(invite_token TEXT, claim_token_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.invitations%ROWTYPE;
  v_group_name TEXT;
  v_session public.guest_sessions%ROWTYPE;
BEGIN
  IF claim_token_hash IS NULL OR length(claim_token_hash) = 0 THEN
    RETURN jsonb_build_object('status', 'invalid', 'message', 'Missing browser claim token.');
  END IF;

  SELECT * INTO v_invite FROM public.invitations WHERE token = invite_token LIMIT 1;
  IF NOT FOUND OR v_invite.status <> 'pending' THEN
    RETURN jsonb_build_object('status', 'invalid', 'message', 'This invite is invalid or has already been used.');
  END IF;

  SELECT name INTO v_group_name FROM public.groups WHERE id = v_invite.group_id;

  SELECT * INTO v_session
  FROM public.guest_sessions
  WHERE invitation_id = v_invite.id
    AND revoked_at IS NULL
    AND expires_at > now()
  LIMIT 1;

  IF FOUND THEN
    IF v_invite.guest_claim_token_hash IS DISTINCT FROM claim_token_hash THEN
      RETURN jsonb_build_object('status', 'claimed', 'message', 'This invite link has already been claimed.');
    END IF;

    UPDATE public.guest_sessions
    SET session_token_hash = claim_guest_invite.session_token_hash,
        last_seen_at = now()
    WHERE id = v_existing_session.id
    RETURNING * INTO v_existing_session;

    RETURN jsonb_build_object(
      'status', 'active',
      'groupId', v_invite.group_id,
      'groupName', COALESCE(v_group_name, 'Group'),
      'guestName', v_session.guest_name,
      'expiresAt', v_session.expires_at
    );
  END IF;

  IF v_invite.expires_at < now() THEN
    RETURN jsonb_build_object('status', 'expired', 'message', 'This invite has expired.');
  END IF;

  IF v_invite.opened_at IS NULL THEN
    UPDATE public.invitations
    SET opened_at = now(),
        guest_session_expires_at = v_invite.expires_at,
        guest_claim_token_hash = claim_token_hash
    WHERE id = v_invite.id
    RETURNING * INTO v_invite;
  END IF;

  IF v_invite.guest_session_expires_at IS NULL OR v_invite.guest_session_expires_at < now() THEN
    RETURN jsonb_build_object('status', 'expired', 'message', 'This guest invite has expired.');
  END IF;

  IF v_invite.guest_claim_token_hash IS DISTINCT FROM claim_token_hash THEN
    RETURN jsonb_build_object('status', 'claimed', 'message', 'This invite link has already been opened in another browser session.');
  END IF;

  RETURN jsonb_build_object(
    'status', 'needs_name',
    'groupId', v_invite.group_id,
    'groupName', COALESCE(v_group_name, 'Group'),
    'expiresAt', v_invite.guest_session_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_guest_invite(
  invite_token TEXT,
  claim_token_hash TEXT,
  session_token_hash TEXT,
  guest_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.invitations%ROWTYPE;
  v_group_name TEXT;
  v_name TEXT := trim(guest_name);
  v_existing_session public.guest_sessions%ROWTYPE;
  v_group_member_id UUID;
  v_session_expires_at TIMESTAMPTZ := now() + interval '10 years';
BEGIN
  IF length(v_name) = 0 OR length(v_name) > 80 THEN
    RETURN jsonb_build_object('status', 'invalid', 'message', 'Enter your name to continue.');
  END IF;

  SELECT * INTO v_invite FROM public.invitations WHERE token = invite_token LIMIT 1;
  IF NOT FOUND OR v_invite.status <> 'pending' THEN
    RETURN jsonb_build_object('status', 'invalid', 'message', 'This invite is invalid or has already been used.');
  END IF;

  SELECT name INTO v_group_name FROM public.groups WHERE id = v_invite.group_id;

  SELECT * INTO v_existing_session
  FROM public.guest_sessions
  WHERE invitation_id = v_invite.id
    AND revoked_at IS NULL
    AND expires_at > now()
  LIMIT 1;

  IF FOUND THEN
    IF v_invite.guest_claim_token_hash IS DISTINCT FROM claim_token_hash THEN
      RETURN jsonb_build_object('status', 'claimed', 'message', 'This invite link has already been claimed.');
    END IF;

    RETURN jsonb_build_object(
      'status', 'active',
      'groupId', v_invite.group_id,
      'groupName', COALESCE(v_group_name, 'Group'),
      'guestName', v_existing_session.guest_name,
      'expiresAt', v_existing_session.expires_at
    );
  END IF;

  IF v_invite.guest_session_expires_at IS NULL OR v_invite.guest_session_expires_at < now() THEN
    RETURN jsonb_build_object('status', 'expired', 'message', 'This guest invite has expired.');
  END IF;

  IF v_invite.guest_claim_token_hash IS DISTINCT FROM claim_token_hash THEN
    RETURN jsonb_build_object('status', 'claimed', 'message', 'This invite link was opened in another browser session.');
  END IF;

  INSERT INTO public.group_members (group_id, user_id, invited_email, display_name, role, status)
  VALUES (v_invite.group_id, null, v_invite.invited_email, v_name, 'member', 'active')
  RETURNING id INTO v_group_member_id;

  INSERT INTO public.guest_sessions (invitation_id, group_member_id, guest_name, session_token_hash, expires_at)
  VALUES (v_invite.id, v_group_member_id, v_name, session_token_hash, v_session_expires_at);

  RETURN jsonb_build_object(
    'status', 'active',
    'groupId', v_invite.group_id,
    'groupName', COALESCE(v_group_name, 'Group'),
    'guestName', v_name,
    'expiresAt', v_session_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_guest_group(session_token_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.guest_sessions%ROWTYPE;
  v_group_id UUID;
  v_group JSONB;
  v_members JSONB;
  v_expenses JSONB;
  v_settlements JSONB;
BEGIN
  SELECT * INTO v_session
  FROM public.guest_sessions
  WHERE guest_sessions.session_token_hash = get_guest_group.session_token_hash
    AND revoked_at IS NULL
    AND expires_at > now()
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'expired', 'message', 'Guest session expired or invalid.');
  END IF;

  SELECT group_members.group_id INTO v_group_id
  FROM public.group_members
  WHERE group_members.id = v_session.group_member_id
    AND group_members.status = 'active';

  IF v_group_id IS NULL THEN
    RETURN jsonb_build_object('status', 'expired', 'message', 'Guest access has been removed.');
  END IF;

  UPDATE public.guest_sessions SET last_seen_at = now() WHERE id = v_session.id;

  SELECT to_jsonb(groups.*) INTO v_group
  FROM (
    SELECT id, name, description, created_at
    FROM public.groups
    WHERE id = v_group_id
  ) groups;

  SELECT COALESCE(jsonb_agg(to_jsonb(members.*)), '[]'::jsonb) INTO v_members
  FROM (
    SELECT id, display_name, role, status, user_id
    FROM public.group_members
    WHERE group_id = v_group_id AND status = 'active'
    ORDER BY created_at ASC
  ) members;

  SELECT COALESCE(jsonb_agg(to_jsonb(expense_rows.*)), '[]'::jsonb) INTO v_expenses
  FROM (
    SELECT
      expenses.id,
      expenses.title,
      expenses.description,
      expenses.amount,
      expenses.expense_date,
      jsonb_build_object('id', paid_by.id, 'display_name', paid_by.display_name) AS paid_by,
      COALESCE((
        SELECT jsonb_agg(to_jsonb(splits.*))
        FROM (
          SELECT id, member_id, amount_owed, is_settled
          FROM public.expense_splits
          WHERE expense_id = expenses.id
        ) splits
      ), '[]'::jsonb) AS splits
    FROM public.expenses
    LEFT JOIN public.group_members paid_by ON paid_by.id = expenses.paid_by_member_id
    WHERE expenses.group_id = v_group_id
    ORDER BY expenses.expense_date DESC
  ) expense_rows;

  SELECT COALESCE(jsonb_agg(to_jsonb(settlement_rows.*)), '[]'::jsonb) INTO v_settlements
  FROM (
    SELECT
      settlements.id,
      settlements.amount,
      settlements.status,
      settlements.settled_at,
      jsonb_build_object('display_name', from_member.display_name) AS from_member,
      jsonb_build_object('display_name', to_member.display_name) AS to_member
    FROM public.settlements
    LEFT JOIN public.group_members from_member ON from_member.id = settlements.from_member_id
    LEFT JOIN public.group_members to_member ON to_member.id = settlements.to_member_id
    WHERE settlements.group_id = v_group_id
    ORDER BY settlements.created_at DESC
  ) settlement_rows;

  RETURN jsonb_build_object(
    'status', 'active',
    'guest', jsonb_build_object(
      'name', v_session.guest_name,
      'expiresAt', v_session.expires_at,
      'memberId', v_session.group_member_id
    ),
    'group', v_group,
    'members', v_members,
    'expenses', v_expenses,
    'settlements', v_settlements
  );
END;
$$;
