import { getSupabaseClient } from './supabaseClient';
import { getCurrentUser } from './auth';
import { logActivity } from './database';

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function createInvite(groupId: string, invitedEmail: string) {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser();
  if (!user.data) throw new Error('Not authenticated.');

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('invitations')
    .insert({
      group_id: groupId,
      invited_email: invitedEmail,
      invited_by: user.data.id,
      token,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  await logActivity(groupId, user.data.id, 'invite_created', { email: invitedEmail, token });

  return {
    invite: data,
    inviteLink: `${import.meta.env.APP_URL || 'http://localhost:3000'}/invite/${token}`,
  };
}

export async function getInviteByToken(token: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('invitations')
    .select('*, group:group_id(name)')
    .eq('token', token)
    .single();

  if (error) throw new Error('Invite not found or invalid.');
  if (data.status !== 'pending') throw new Error('This invite has already been used.');
  if (new Date(data.expires_at) < new Date()) throw new Error('This invite has expired.');

  return data;
}

export async function acceptInvite(token: string) {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser();
  if (!user.data) throw new Error('You must be logged in to accept an invite.');

  const invite = await getInviteByToken(token);

  if (invite.invited_email !== user.data.email) {
    throw new Error('This invite was sent to a different email address.');
  }

  const { data: existingMember } = await supabase
    .from('group_members')
    .select('id')
    .eq('group_id', invite.group_id)
    .eq('user_id', user.data.id)
    .single();

  if (existingMember) {
    await supabase
      .from('group_members')
      .update({ status: 'active' })
      .eq('id', existingMember.id);

    await supabase
      .from('invitations')
      .update({ status: 'accepted' })
      .eq('id', invite.id);

    return { groupId: invite.group_id, alreadyMember: true };
  }

  await supabase.from('group_members').insert({
    group_id: invite.group_id,
    user_id: user.data.id,
    display_name: user.data.email?.split('@')[0] || 'Member',
    role: 'member',
    status: 'active',
  });

  await supabase
    .from('invitations')
    .update({ status: 'accepted' })
    .eq('id', invite.id);

  await logActivity(invite.group_id, user.data.id, 'invite_accepted', {});

  return { groupId: invite.group_id, alreadyMember: false };
}

export async function getUserInvitations() {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser();
  if (!user.data || !user.data.email) return [];

  const { data, error } = await supabase
    .from('invitations')
    .select('*, group:group_id(name)')
    .eq('invited_email', user.data.email)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}
