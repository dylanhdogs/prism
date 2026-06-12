import { getSupabaseClient } from './supabaseClient';
import type { User, Session, AuthError } from '@supabase/supabase-js';

export type AuthResult<T> = { data: T; error: null } | { data: null; error: string };
export type PageAuthState =
  | { status: 'authenticated'; user: User; session: Session }
  | { status: 'signed_out'; user: null; session: null }
  | { status: 'stale_session'; user: null; session: null };

export const STALE_SESSION_MESSAGE = 'Your old session is no longer valid. Please log in again or create a new account.';

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

function getAppOrigin(): string {
  return (import.meta.env.VITE_APP_URL || window.location.origin).replace(/\/$/, '');
}

export async function signUp(email: string, password: string, fullName?: string): Promise<AuthResult<{ user: User | null; session: Session | null }>> {
  const supabase = getSupabaseClient();
  const emailRedirectTo = `${getAppOrigin()}/confirm-account`;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo,
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

export async function getPageAuthState(): Promise<PageAuthState> {
  const supabase = getSupabaseClient();
  const sessionResult = await supabase.auth.getSession();
  const session = sessionResult.data.session;
  if (sessionResult.error || !session) {
    return { status: 'signed_out', user: null, session: null };
  }

  const userResult = await supabase.auth.getUser();
  if (userResult.error || !userResult.data.user) {
    await supabase.auth.signOut({ scope: 'local' });
    return { status: 'stale_session', user: null, session: null };
  }

  return { status: 'authenticated', user: userResult.data.user, session };
}

export async function resetPassword(email: string): Promise<AuthResult<null>> {
  const supabase = getSupabaseClient();
  const redirectTo = `${getAppOrigin()}/update-password`;
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
