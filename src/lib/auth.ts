import { getSupabaseClient } from './supabaseClient';
import type { User, Session, AuthError } from '@supabase/supabase-js';

export type AuthResult<T> = { data: T; error: null } | { data: null; error: string };

function handleAuthError(error: AuthError | null): string | null {
  if (!error) return null;
  if (error.message === 'Invalid login credentials') {
    return 'Invalid email or password. Please try again.';
  }
  if (error.message.includes('Email not confirmed')) {
    return 'Please confirm your email address before signing in.';
  }
  if (error.message.includes('User already registered')) {
    return 'An account with this email already exists.';
  }
  return error.message;
}

export async function signUp(email: string, password: string, fullName?: string): Promise<AuthResult<{ user: User | null; session: Session | null }>> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
    },
  });

  const message = handleAuthError(error);
  if (message) return { data: null, error: message };
  return { data: { user: data.user, session: data.session }, error: null };
}

export async function logIn(email: string, password: string): Promise<AuthResult<{ user: User; session: Session }>> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  const message = handleAuthError(error);
  if (message) return { data: null, error: message };
  if (!data.user || !data.session) return { data: null, error: 'Login failed. Please try again.' };
  return { data: { user: data.user, session: data.session }, error: null };
}

export async function logOut(): Promise<AuthResult<null>> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) return { data: null, error: error.message };
  return { data: null, error: null };
}

export async function getCurrentUser(): Promise<AuthResult<User>> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { data: null, error: error?.message ?? 'Not authenticated' };
  return { data: data.user, error: null };
}

export async function getSession(): Promise<AuthResult<Session>> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return { data: null, error: error?.message ?? 'No active session' };
  return { data: data.session, error: null };
}

export async function resetPassword(email: string): Promise<AuthResult<null>> {
  const supabase = getSupabaseClient();
  const redirectTo = `${import.meta.env.SITE_URL || import.meta.env.APP_URL || 'http://localhost:3000'}/update-password`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) return { data: null, error: error.message };
  return { data: null, error: null };
}

export async function updatePassword(newPassword: string): Promise<AuthResult<null>> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { data: null, error: error.message };
  return { data: null, error: null };
}

export function onAuthStateChange(callback: (event: string, session: Session | null) => void): () => void {
  const supabase = getSupabaseClient();
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return () => data?.subscription?.unsubscribe();
}
