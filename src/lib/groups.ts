import { getSupabaseClient } from './supabaseClient';
import { getCurrentUser } from './auth';
import { logActivity } from './database';
import type { Group, GroupMember } from './database.types';

export async function requireGroupAdmin(groupId: string) {
  // Legacy name kept for older imports; owner is now the only elevated role.
  return requireGroupOwner(groupId);
}

export async function requireGroupOwner(groupId: string) {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser();
  if (!user.data) throw new Error('Not authenticated.');

  const { data: membership, error } = await supabase
    .from('group_members')
    .select('id, role')
    .eq('group_id', groupId)
    .eq('user_id', user.data.id)
    .eq('status', 'active')
    .single();

  if (error || !membership || membership.role !== 'owner') {
    throw new Error('Only the group owner can do that.');
  }

  return { user: user.data, membership };
}

export async function createGroup(name: string, description?: string) {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser();
  if (!user.data) throw new Error('You must be logged in to create a group.');

  const { data: group, error } = await supabase
    .from('groups')
    .insert({ name, description: description ?? null, created_by: user.data.id })
    .select()
    .single();
  if (error) throw new Error(error.message);

  await supabase.from('group_members').insert({
    group_id: group.id,
    user_id: user.data.id,
    display_name: user.data.email,
    role: 'owner',
    status: 'active',
  });

  await logActivity(group.id, user.data.id, 'group_created', { name });
  return group as Group;
}

export async function updateGroupSettings(groupId: string, name: string, description?: string) {
  const supabase = getSupabaseClient();
  const { user } = await requireGroupOwner(groupId);
  const nextName = name.trim();
  const nextDescription = description?.trim() || null;

  if (!nextName || nextName.length > 100) {
    throw new Error('Enter a group name between 1 and 100 characters.');
  }

  if (nextDescription && nextDescription.length > 500) {
    throw new Error('Keep the description under 500 characters.');
  }

  const { data, error } = await supabase
    .from('groups')
    .update({ name: nextName, description: nextDescription })
    .eq('id', groupId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  await logActivity(groupId, user.id, 'group_updated', { name: nextName });
  return data as Group;
}

export async function getUserGroups() {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser();
  if (!user.data) throw new Error('Not authenticated.');

  const { data, error } = await supabase
    .from('group_members')
    .select('group_id, groups(*)')
    .eq('user_id', user.data.id)
    .eq('status', 'active');

  if (error) throw new Error(error.message);
  if (!data) return [];
  return data.map((m) => m.groups).filter(Boolean) as unknown as Group[];
}

export async function getGroupById(groupId: string) {
  const supabase = getSupabaseClient();
  const user = await getCurrentUser();
  if (!user.data) throw new Error('Not authenticated.');

  const { data: membership, error: membershipError } = await supabase
    .from('group_members')
    .select('id')
    .eq('group_id', groupId)
    .eq('user_id', user.data.id)
    .eq('status', 'active')
    .single();

  if (membershipError || !membership) {
    throw new Error('You do not have access to this group.');
  }

  const { data, error } = await supabase
    .from('groups')
    .select('*')
    .eq('id', groupId)
    .single();

  if (error) throw new Error(error.message);
  return data as Group;
}

export async function getGroupMembers(groupId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('group_members')
    .select('*, profiles:user_id(full_name, email, avatar_url)')
    .eq('group_id', groupId)
    .eq('status', 'active');

  if (error) throw new Error(error.message);
  return (data || []) as (GroupMember & { profiles: { full_name: string; email: string; avatar_url: string | null } | null })[];
}

export async function addGroupMember(groupId: string, email: string, displayName?: string) {
  const supabase = getSupabaseClient();
  const { user } = await requireGroupOwner(groupId);

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single();

  const { data, error } = await supabase
    .from('group_members')
    .insert({
      group_id: groupId,
      user_id: profile?.id ?? null,
      invited_email: profile ? null : email,
      display_name: displayName ?? email.split('@')[0],
      role: 'member',
      status: 'active',
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  await logActivity(groupId, user.id, 'member_added', { email, name: displayName });
  return data as GroupMember;
}

export async function updateGroupMemberName(groupId: string, memberId: string, displayName: string) {
  const supabase = getSupabaseClient();
  const { user } = await requireGroupOwner(groupId);
  const nextName = displayName.trim();

  if (!nextName || nextName.length > 80) {
    throw new Error('Enter a member name between 1 and 80 characters.');
  }

  const { data, error } = await supabase
    .from('group_members')
    .update({ display_name: nextName })
    .eq('id', memberId)
    .eq('group_id', groupId)
    .eq('status', 'active')
    .select()
    .single();

  if (error) throw new Error(error.message);
  await logActivity(groupId, user.id, 'member_updated', { member_id: memberId, display_name: nextName });
  return data as GroupMember;
}

export async function removeGroupMember(groupId: string, memberId: string) {
  const supabase = getSupabaseClient();
  const { user } = await requireGroupOwner(groupId);

  const { data: targetMember, error: targetError } = await supabase
    .from('group_members')
    .select('id, role')
    .eq('id', memberId)
    .eq('group_id', groupId)
    .eq('status', 'active')
    .single();

  if (targetError || !targetMember) {
    throw new Error('Member not found.');
  }

  if (targetMember.role === 'owner') {
    const { count, error: countError } = await supabase
      .from('group_members')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', groupId)
      .eq('role', 'owner')
      .eq('status', 'active');

    if (countError) throw new Error(countError.message);
    if ((count ?? 0) <= 1) {
      throw new Error('You cannot remove the only owner of this group.');
    }
  }

  const { error } = await supabase
    .from('group_members')
    .update({ status: 'removed' })
    .eq('id', memberId)
    .eq('group_id', groupId);

  if (error) throw new Error(error.message);
  await logActivity(groupId, user.id, 'member_removed', { member_id: memberId });
}
