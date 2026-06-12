import { getSupabaseClient } from './supabaseClient';
import { getCurrentUser } from './auth';
import { logActivity } from './database';

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
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
    inviteLink: `${import.meta.env.VITE_APP_URL || window.location.origin}/invite/${token}`,
  };
}

export async function getInviteByToken(token: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc('get_invite_by_token', { invite_token: token })
    .single();

  if (error) throw new Error('Invite not found or invalid.');
  if (data.status !== 'pending') throw new Error('This invite has already been used.');
  if (new Date(data.expires_at) < new Date()) throw new Error('This invite has expired.');

  return {
    ...data,
    group: { name: data.group_name },
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

  await logActivity(data.group_id, user.data.id, 'invite_accepted', {});

  return { groupId: data.group_id, alreadyMember: data.already_member };
}
