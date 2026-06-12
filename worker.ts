import { createClient } from '@supabase/supabase-js';

const GUEST_COOKIE = 'prism_guest_session';
const CLAIM_COOKIE = 'prism_guest_claim';
const DAY_SECONDS = 24 * 60 * 60;

type Env = {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  VITE_SUPABASE_URL?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers || {}),
    },
  });
}

function getSupabase(env: Env) {
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error('Missing Supabase service role environment variables.');
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function getCookie(request: Request, name: string) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

function setCookie(name: string, value: string, maxAgeSeconds: number = DAY_SECONDS) {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function secondsUntil(dateValue: string) {
  return Math.max(1, Math.floor((new Date(dateValue).getTime() - Date.now()) / 1000));
}

async function getInvite(supabase: any, token: string) {
  const { data, error } = await supabase
    .from('invitations')
    .select('id, group_id, token, status, expires_at, opened_at, guest_session_expires_at, guest_claim_token_hash, group:group_id(name)')
    .eq('token', token)
    .single();
  return error || !data ? null : data as any;
}

async function ensureInviteOpened(supabase: any, invite: any) {
  const now = new Date();
  if (invite.opened_at && invite.guest_session_expires_at) return { invite, rawClaimToken: '' };

  const expiresAt = new Date(now.getTime() + DAY_SECONDS * 1000).toISOString();
  const rawClaimToken = randomToken();
  const claimTokenHash = await sha256(rawClaimToken);
  const { data, error } = await supabase
    .from('invitations')
    .update({ opened_at: now.toISOString(), guest_session_expires_at: expiresAt, guest_claim_token_hash: claimTokenHash })
    .eq('id', invite.id)
    .is('opened_at', null)
    .select('id, group_id, token, status, expires_at, opened_at, guest_session_expires_at, guest_claim_token_hash, group:group_id(name)')
    .single();

  return error || !data ? { invite, rawClaimToken: '' } : { invite: data as any, rawClaimToken };
}

async function getExistingSession(supabase: any, invitationId: string) {
  const { data } = await supabase
    .from('guest_sessions')
    .select('id, guest_name, session_token_hash, expires_at, revoked_at')
    .eq('invitation_id', invitationId)
    .is('revoked_at', null)
    .single();
  return data as any || null;
}

async function invitePayload(request: Request, supabase: any, invite: any) {
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
    const rawCookie = getCookie(request, GUEST_COOKIE);
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
    return json({ status: 'claimed', message: 'This invite link has already been claimed in another browser session.' }, { status: 409 });
  }

  const rawClaimCookie = getCookie(request, CLAIM_COOKIE);
  const claimCookieHash = rawClaimCookie ? await sha256(rawClaimCookie) : '';
  if (!opened.rawClaimToken && (!claimCookieHash || claimCookieHash !== openedInvite.guest_claim_token_hash)) {
    return json({ status: 'claimed', message: 'This invite link has already been opened in another browser session.' }, { status: 409 });
  }

  const headers = opened.rawClaimToken ? { 'set-cookie': setCookie(CLAIM_COOKIE, opened.rawClaimToken, secondsUntil(accessExpiresAt)) } : undefined;
  return json({
    status: 'needs_name',
    groupId: openedInvite.group_id,
    groupName: openedInvite.group?.name || 'Group',
    expiresAt: accessExpiresAt,
  }, headers ? { headers } : undefined);
}

async function handleInviteApi(request: Request, env: Env, token: string) {
  const supabase = getSupabase(env);
  const invite = await getInvite(supabase, token);

  if (request.method === 'GET') return invitePayload(request, supabase, invite);
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, { status: 405 });
  if (!invite) return json({ status: 'invalid', message: 'Invite not found.' }, { status: 404 });

  const body = await request.json().catch(() => ({})) as { guestName?: string };
  const guestName = String(body.guestName || '').trim().slice(0, 80);
  if (!guestName) return json({ status: 'invalid', message: 'Enter your name to continue.' }, { status: 400 });

  const initial = await invitePayload(request, supabase, invite);
  if (initial.status !== 200) return initial;

  const initialPayload = await initial.clone().json() as any;
  if (initialPayload.status === 'active') return initial;
  if (initialPayload.status !== 'needs_name') return initial;

  const rawSessionToken = randomToken();
  const sessionTokenHash = await sha256(rawSessionToken);
  const expiresAt = initialPayload.expiresAt;
  const { data, error } = await supabase
    .from('guest_sessions')
    .insert({ invitation_id: invite.id, guest_name: guestName, session_token_hash: sessionTokenHash, expires_at: expiresAt })
    .select('id')
    .single();

  if (error || !data) return json({ status: 'claimed', message: 'This invite link has already been claimed.' }, { status: 409 });

  return json({ status: 'active', groupId: invite.group_id, groupName: initialPayload.groupName, guestName, expiresAt }, {
    headers: { 'set-cookie': setCookie(GUEST_COOKIE, rawSessionToken, secondsUntil(expiresAt)) },
  });
}

async function getValidGuestSession(request: Request, env: Env) {
  const rawToken = getCookie(request, GUEST_COOKIE);
  if (!rawToken) return null;
  const supabase = getSupabase(env);
  const sessionTokenHash = await sha256(rawToken);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('guest_sessions')
    .select('id, guest_name, expires_at, revoked_at, invitation:invitation_id(id, group_id, token, guest_session_expires_at)')
    .eq('session_token_hash', sessionTokenHash)
    .is('revoked_at', null)
    .gt('expires_at', now)
    .single();
  if (error || !data || !data.invitation) return null;
  const invitation = data.invitation as unknown as { group_id: string };
  await supabase.from('guest_sessions').update({ last_seen_at: now }).eq('id', data.id);
  return { supabase, session: data as any, groupId: invitation.group_id };
}

async function handleGuestGroup(request: Request, env: Env) {
  if (request.method !== 'GET') return json({ message: 'Method not allowed.' }, { status: 405 });
  const valid = await getValidGuestSession(request, env);
  if (!valid) return json({ message: 'Guest session expired or invalid.' }, { status: 401 });
  const { supabase, session, groupId } = valid;
  const [groupResult, membersResult, expensesResult, settlementsResult] = await Promise.all([
    supabase.from('groups').select('id, name, description, created_at').eq('id', groupId).single(),
    supabase.from('group_members').select('id, display_name, role, status, user_id').eq('group_id', groupId).eq('status', 'active'),
    supabase.from('expenses').select('id, title, description, amount, expense_date, paid_by:paid_by_member_id(id, display_name), splits:expense_splits(id, member_id, amount_owed, is_settled)').eq('group_id', groupId).order('expense_date', { ascending: false }),
    supabase.from('settlements').select('id, amount, status, settled_at, from_member:from_member_id(display_name), to_member:to_member_id(display_name)').eq('group_id', groupId).order('created_at', { ascending: false }),
  ]);
  if (groupResult.error || !groupResult.data) return json({ message: 'Unable to load guest group.' }, { status: 404 });
  return json({
    guest: { name: session.guest_name, expiresAt: session.expires_at },
    group: groupResult.data,
    members: membersResult.data || [],
    expenses: expensesResult.data || [],
    settlements: settlementsResult.data || [],
  });
}

function rewriteAssetRequest(request: Request) {
  const url = new URL(request.url);
  const rewrites: Record<string, string> = {
    '/login': '/login.html',
    '/signup': '/signup.html',
    '/forgot-password': '/forgot-password.html',
    '/update-password': '/update-password.html',
    '/dashboard': '/dashboard.html',
    '/groups': '/groups.html',
    '/guest': '/guest.html',
  };

  if (url.pathname.startsWith('/invite/')) url.pathname = '/invite.html';
  else if (rewrites[url.pathname]) url.pathname = rewrites[url.pathname];
  else return request;

  return new Request(url.toString(), request);
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/invite/')) {
        const token = decodeURIComponent(url.pathname.slice('/api/invite/'.length));
        return handleInviteApi(request, env, token);
      }
      if (url.pathname === '/api/guest/group') return handleGuestGroup(request, env);
      return env.ASSETS.fetch(rewriteAssetRequest(request));
    } catch (error: any) {
      return json({ message: error.message || 'Server error.' }, { status: 500 });
    }
  },
};
