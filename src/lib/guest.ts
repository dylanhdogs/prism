import { getSupabaseClient } from './supabaseClient';

const CLAIM_PREFIX = 'prism_guest_claim_';
const SESSION_TOKEN_KEY = 'prism_guest_session_token';

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getClaimToken(inviteToken: string) {
  const key = `${CLAIM_PREFIX}${inviteToken}`;
  let token = localStorage.getItem(key);
  if (!token) {
    token = randomToken();
    localStorage.setItem(key, token);
  }
  return token;
}

function saveGuestSessionToken(token: string) {
  localStorage.setItem(SESSION_TOKEN_KEY, token);
}

function getGuestSessionToken() {
  return localStorage.getItem(SESSION_TOKEN_KEY) || '';
}

function assertActive(data: any) {
  if (!data || data.status === 'invalid' || data.status === 'expired' || data.status === 'claimed') {
    throw new Error(data?.message || 'Guest access is unavailable.');
  }
  return data;
}

export async function openGuestInvite(token: string) {
  const supabase = getSupabaseClient();
  const claimTokenHash = await sha256(getClaimToken(token));
  const { data, error } = await supabase.rpc('open_guest_invite', {
    invite_token: token,
    claim_token_hash: claimTokenHash,
  });

  if (error) throw new Error(error.message);
  return assertActive(data);
}

export async function createGuestSession(token: string, guestName: string) {
  const supabase = getSupabaseClient();
  const rawSessionToken = randomToken();
  const [claimTokenHash, sessionTokenHash] = await Promise.all([
    sha256(getClaimToken(token)),
    sha256(rawSessionToken),
  ]);

  const { data, error } = await supabase.rpc('claim_guest_invite', {
    invite_token: token,
    claim_token_hash: claimTokenHash,
    session_token_hash: sessionTokenHash,
    guest_name: guestName,
  });

  if (error) throw new Error(error.message);
  const result = assertActive(data);
  saveGuestSessionToken(rawSessionToken);
  return result;
}

export async function getGuestGroup() {
  const rawSessionToken = getGuestSessionToken();
  if (!rawSessionToken) throw new Error('Guest session expired or invalid.');

  const supabase = getSupabaseClient();
  const sessionTokenHash = await sha256(rawSessionToken);
  const { data, error } = await supabase.rpc('get_guest_group', { session_token_hash: sessionTokenHash });

  if (error) throw new Error(error.message);
  return assertActive(data);
}
