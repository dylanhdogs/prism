-- 004_settlements.sql
-- Creates the settlements table.

CREATE TABLE IF NOT EXISTS public.settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  from_member_id UUID NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  to_member_id UUID NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'cancelled')),
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_settlements_group_id ON public.settlements(group_id);
CREATE INDEX IF NOT EXISTS idx_settlements_from_member ON public.settlements(from_member_id);
CREATE INDEX IF NOT EXISTS idx_settlements_to_member ON public.settlements(to_member_id);

-- RLS
CREATE POLICY "Members can view group settlements"
  ON public.settlements
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_members.group_id = settlements.group_id
        AND group_members.user_id = auth.uid()
        AND group_members.status = 'active'
    )
  );

CREATE POLICY "Members can create settlements"
  ON public.settlements
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_members.group_id = settlements.group_id
        AND group_members.user_id = auth.uid()
        AND group_members.status = 'active'
    )
  );

CREATE POLICY "Members can update settlements in their groups"
  ON public.settlements
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_members.group_id = settlements.group_id
        AND group_members.user_id = auth.uid()
        AND group_members.status = 'active'
    )
  );
