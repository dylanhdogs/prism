import { getSupabaseClient } from './supabaseClient';
import { getCurrentUser } from './auth';
import { requireGroupAdmin } from './groups';
import { logActivity } from './database';
import type { Invitation } from './database.types';

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

async function getGroupName(groupId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('groups')
    .select('name')
    .eq('id', groupId)
    .single();

  if (error || !data) throw new Error('Could not load the group name.');
  return data.name;
}

export async function sendInviteEmail(recipientEmail: string, inviteLink: string, groupName: string) {
  const response = await fetch('/api/send-invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipientEmail,
      inviteLink,
      groupName,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Invite emails are not available in the local dev server yet. The invite link was still created, so you can copy and share it.');
    }
    throw new Error(payload?.error || 'Unable to send the invite email.');
  }
}

export async function createInvite(groupId: string, invitedEmail?: string) {
  const supabase = getSupabaseClient();
  const { user } = await requireGroupAdmin(groupId);
  const groupName = await getGroupName(groupId);

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('invitations')
    .insert({
      group_id: groupId,
      invited_by: user.id,
      invited_email: invitedEmail?.trim() || null,
      token,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  await logActivity(groupId, user.id, 'invite_created', { token });

  return {
    invite: data,
    inviteLink: buildInviteLink(token),
    groupName,
  };
}

export function buildInviteUrl(token: string) {
  return buildInviteLink(token);
}

export async function getGroupInvitations(groupId: string) {
  const supabase = getSupabaseClient();
  await requireGroupAdmin(groupId);

  const { data, error } = await supabase
    .from('invitations')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data || []) as Invitation[];
}

export async function cancelInvite(groupId: string, inviteId: string) {
  const supabase = getSupabaseClient();
  const { user } = await requireGroupAdmin(groupId);

  const { data: invite, error: inviteError } = await supabase
    .from('invitations')
    .select('id, status')
    .eq('id', inviteId)
    .eq('group_id', groupId)
    .single();

  if (inviteError || !invite) throw new Error('Invite not found.');
  if (invite.status !== 'pending') throw new Error('Only pending invites can be cancelled.');

  const { error } = await supabase
    .from('invitations')
    .update({ status: 'cancelled' })
    .eq('id', inviteId)
    .eq('group_id', groupId);

  if (error) throw new Error(error.message);
  await logActivity(groupId, user.id, 'invite_cancelled', { invite_id: inviteId });
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
