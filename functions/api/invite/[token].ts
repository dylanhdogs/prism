import { getClaimCookie, getCookie, getSupabase, guestClaimCookie, guestCookie, json, randomToken, secondsUntil, sha256 } from '../../_lib/guest';

function getToken(context: { params: Record<string, string | string[]> }) {
  const value = context.params.token;
  return Array.isArray(value) ? value[0] : value;
}

async function getInvite(supabase: ReturnType<typeof getSupabase>, token: string) {
  const { data, error } = await supabase
    .from('invitations')
    .select('id, group_id, token, status, expires_at, opened_at, guest_session_expires_at, guest_claim_token_hash, group:group_id(name)')
    .eq('token', token)
    .single();

  if (error || !data) return null;
  return data;
}

async function ensureInviteOpened(supabase: ReturnType<typeof getSupabase>, invite: any) {
  const now = new Date();
  if (invite.opened_at && invite.guest_session_expires_at) return { invite, rawClaimToken: '' };

  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const rawClaimToken = randomToken();
  const claimTokenHash = await sha256(rawClaimToken);
  const { data, error } = await supabase
    .from('invitations')
    .update({ opened_at: now.toISOString(), guest_session_expires_at: expiresAt, guest_claim_token_hash: claimTokenHash })
    .eq('id', invite.id)
    .is('opened_at', null)
    .select('id, group_id, token, status, expires_at, opened_at, guest_session_expires_at, guest_claim_token_hash, group:group_id(name)')
    .single();

  return error || !data ? { invite, rawClaimToken: '' } : { invite: data, rawClaimToken };
}

async function getExistingSession(supabase: ReturnType<typeof getSupabase>, invitationId: string) {
  const { data } = await supabase
    .from('guest_sessions')
    .select('id, guest_name, session_token_hash, expires_at, revoked_at')
    .eq('invitation_id', invitationId)
    .is('revoked_at', null)
    .single();
  return data || null;
}

async function inviteResponse(request: Request, supabase: ReturnType<typeof getSupabase>, invite: any) {
  if (!invite || invite.status !== 'pending') {
    return json({ status: 'invalid', message: 'This invite is invalid or has already been used.' }, { status: 404 });
  }

  if (new Date(invite.expires_at) < new Date()) {
    return json({ status: 'expired', message: 'This invite has expired.' }, { status: 410 });
  }

  const opened = await ensureInviteOpened(supabase, invite);
  const openedInvite = opened.invite;
  const accessExpiresAt = openedInvite.guest_session_expires_at;

  if (!accessExpiresAt || new Date(accessExpiresAt) < new Date()) {
    return json({ status: 'expired', message: 'This guest access window has expired.' }, { status: 410 });
  }

  const existingSession = await getExistingSession(supabase, openedInvite.id);
  if (existingSession) {
    const rawCookie = getCookie(request);
    const cookieHash = rawCookie ? await sha256(rawCookie) : '';
    if (cookieHash && cookieHash === existingSession.session_token_hash && new Date(existingSession.expires_at) > new Date()) {
      return json({
        status: 'active',
        groupId: openedInvite.group_id,
        groupName: openedInvite.group?.name || 'Group',
        guestName: existingSession.guest_name,
        expiresAt: existingSession.expires_at,
      });
    }

    return json({
      status: 'claimed',
      message: 'This invite link has already been claimed in another browser session.',
    }, { status: 409 });
  }

  const rawClaimCookie = getClaimCookie(request);
  const claimCookieHash = rawClaimCookie ? await sha256(rawClaimCookie) : '';
  if (!opened.rawClaimToken && (!claimCookieHash || claimCookieHash !== openedInvite.guest_claim_token_hash)) {
    return json({
      status: 'claimed',
      message: 'This invite link has already been opened in another browser session.',
    }, { status: 409 });
  }

  const headers = opened.rawClaimToken ? { 'set-cookie': guestClaimCookie(opened.rawClaimToken, secondsUntil(accessExpiresAt)) } : undefined;

  return json({
    status: 'needs_name',
    groupId: openedInvite.group_id,
    groupName: openedInvite.group?.name || 'Group',
    expiresAt: accessExpiresAt,
  }, headers ? { headers } : undefined);
}

export async function onRequestGet(context: any) {
  try {
    const token = getToken(context);
    if (!token) return json({ status: 'invalid', message: 'Missing invite token.' }, { status: 400 });

    const supabase = getSupabase(context.env);
    const invite = await getInvite(supabase, token);
    return inviteResponse(context.request, supabase, invite);
  } catch (error: any) {
    return json({ status: 'error', message: error.message || 'Unable to load invite.' }, { status: 500 });
  }
}

export async function onRequestPost(context: any) {
  try {
    const token = getToken(context);
    if (!token) return json({ status: 'invalid', message: 'Missing invite token.' }, { status: 400 });

    const body = await context.request.json().catch(() => ({}));
    const guestName = String(body.guestName || '').trim().slice(0, 80);
    if (!guestName) return json({ status: 'invalid', message: 'Enter your name to continue.' }, { status: 400 });

    const supabase = getSupabase(context.env);
    const invite = await getInvite(supabase, token);
    if (!invite) return json({ status: 'invalid', message: 'Invite not found.' }, { status: 404 });

    const initial = await inviteResponse(context.request, supabase, invite);
    if (initial.status !== 200) return initial;

    const initialPayload = await initial.clone().json();
    if (initialPayload.status === 'active') return initial;
    if (initialPayload.status !== 'needs_name') return initial;

    const rawSessionToken = randomToken();
    const sessionTokenHash = await sha256(rawSessionToken);
    const expiresAt = initialPayload.expiresAt;

    const { data, error } = await supabase
      .from('guest_sessions')
      .insert({
        invitation_id: invite.id,
        guest_name: guestName,
        session_token_hash: sessionTokenHash,
        expires_at: expiresAt,
      })
      .select('id')
      .single();

    if (error || !data) {
      return json({ status: 'claimed', message: 'This invite link has already been claimed.' }, { status: 409 });
    }

    return json({
      status: 'active',
      groupId: invite.group_id,
      groupName: initialPayload.groupName,
      guestName,
      expiresAt,
    }, {
      headers: { 'set-cookie': guestCookie(rawSessionToken, secondsUntil(expiresAt)) },
    });
  } catch (error: any) {
    return json({ status: 'error', message: error.message || 'Unable to create guest session.' }, { status: 500 });
  }
}
