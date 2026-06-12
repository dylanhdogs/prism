import { getSupabaseClient } from './supabaseClient';
import { getCurrentUser } from './auth';
import { logActivity } from './database';

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getAppOrigin(): string {
  return (import.meta.env.VITE_APP_URL || window.location.origin).replace(/\/$/, '');
}

function buildInviteLink(token: string): string {
  const url = new URL('/invite.html', `${getAppOrigin()}/`);
  url.searchParams.set('token', token);
  return url.toString();
}

export async function createInvite(groupId: string) {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser();
  if (!user.data) throw new Error('Not authenticated.');

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('invitations')
    .insert({
      group_id: groupId,
      invited_by: user.data.id,
      token,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  await logActivity(groupId, user.data.id, 'invite_created', { token });

  return {
    invite: data,
    inviteLink: buildInviteLink(token),
  };
}

export async function getInviteByToken(token: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc('get_invite_by_token', { invite_token: token })
    .single();

  const invite = data as { status: string; expires_at: string; group_name: string | null };
  if (error) throw new Error('Invite not found or invalid.');
  if (invite.status !== 'pending') throw new Error('This invite has already been used.');
  if (new Date(invite.expires_at) < new Date()) throw new Error('This invite has expired.');

  return {
    ...invite,
    group: { name: invite.group_name },
  };
}

export async function acceptInvite(token: string) {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser();
  if (!user.data) throw new Error('You must be logged in to accept an invite.');

  const { data, error } = await supabase
    .rpc('accept_invite_by_token', { invite_token: token })
    .single();

  if (error) throw new Error(error.message);
  const result = data as { group_id: string; already_member: boolean };

  await logActivity(result.group_id, user.data.id, 'invite_accepted', {});

  return { groupId: result.group_id, alreadyMember: result.already_member };
}
