-- 009_guest_sessions.sql
-- Adds 24-hour read-only guest access tied to invite links.

ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS guest_session_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS guest_claim_token_hash TEXT;

CREATE TABLE IF NOT EXISTS public.guest_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID NOT NULL UNIQUE REFERENCES public.invitations(id) ON DELETE CASCADE,
  guest_name TEXT NOT NULL CHECK (length(trim(guest_name)) BETWEEN 1 AND 80),
  session_token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ
);

ALTER TABLE public.guest_sessions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_guest_sessions_invitation_id ON public.guest_sessions(invitation_id);
CREATE INDEX IF NOT EXISTS idx_guest_sessions_token_hash ON public.guest_sessions(session_token_hash);
CREATE INDEX IF NOT EXISTS idx_guest_sessions_expires_at ON public.guest_sessions(expires_at);

-- Guest sessions are accessed only by server-side Cloudflare Functions with the
-- Supabase service role key. No client RLS policies are intentionally created.
