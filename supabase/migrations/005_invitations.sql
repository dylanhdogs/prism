-- 005_invitations.sql
-- Creates the invitations table for group invites.

CREATE TABLE IF NOT EXISTS public.invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  invited_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_invitations_token ON public.invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON public.invitations(invited_email);
CREATE INDEX IF NOT EXISTS idx_invitations_group_id ON public.invitations(group_id);

-- RLS
CREATE POLICY "Members can view invitations for their groups"
  ON public.invitations
  FOR SELECT
  USING (
    invited_email = auth.email()
    OR EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_members.group_id = invitations.group_id
        AND group_members.user_id = auth.uid()
        AND group_members.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Members can create invitations"
  ON public.invitations
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_members.group_id = invitations.group_id
        AND group_members.user_id = auth.uid()
        AND group_members.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Invited user or group owners can update"
  ON public.invitations
  FOR UPDATE
  USING (
    invited_email = auth.email()
    OR EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_members.group_id = invitations.group_id
        AND group_members.user_id = auth.uid()
        AND group_members.role IN ('owner', 'admin')
    )
  );
