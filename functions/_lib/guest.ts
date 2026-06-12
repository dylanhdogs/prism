import { createClient } from '@supabase/supabase-js';

const COOKIE_NAME = 'prism_guest_session';
const CLAIM_COOKIE_NAME = 'prism_guest_claim';
const DAY_SECONDS = 24 * 60 * 60;

export function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers || {}),
    },
  });
}

export function getSupabase(env: Record<string, string>) {
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Missing Supabase service role environment variables.');
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getCookie(request: Request, name: string = COOKIE_NAME) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

export function guestCookie(value: string, maxAgeSeconds: number = DAY_SECONDS) {
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function getClaimCookie(request: Request) {
  return getCookie(request, CLAIM_COOKIE_NAME);
}

export function guestClaimCookie(value: string, maxAgeSeconds: number = DAY_SECONDS) {
  return `${CLAIM_COOKIE_NAME}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function getValidGuestSession(request: Request, env: Record<string, string>) {
  const rawToken = getCookie(request);
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

  return { supabase, session: data, groupId: invitation.group_id };
}

export function secondsUntil(dateValue: string) {
  return Math.max(1, Math.floor((new Date(dateValue).getTime() - Date.now()) / 1000));
}
