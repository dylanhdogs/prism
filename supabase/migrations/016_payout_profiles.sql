-- 016_payout_profiles.sql
-- Stores a user's safe payout profile metadata. Raw bank credentials must not
-- be stored in Prism; provider onboarding should populate provider_account_id.

CREATE TABLE IF NOT EXISTS public.payout_profiles (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  method_type TEXT NOT NULL DEFAULT 'bank_transfer'
    CHECK (method_type IN ('bank_transfer', 'paypal', 'venmo', 'zelle', 'cash_app', 'custom')),
  display_name TEXT NOT NULL DEFAULT 'My receiving account',
  account_label TEXT,
  masked_account TEXT,
  instructions TEXT,
  provider_account_id TEXT,
  status TEXT NOT NULL DEFAULT 'manual'
    CHECK (status IN ('manual', 'pending_provider', 'verified', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.payout_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their payout profile" ON public.payout_profiles;
CREATE POLICY "Users can view their payout profile"
  ON public.payout_profiles FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create their payout profile" ON public.payout_profiles;
CREATE POLICY "Users can create their payout profile"
  ON public.payout_profiles FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their payout profile" ON public.payout_profiles;
CREATE POLICY "Users can update their payout profile"
  ON public.payout_profiles FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their payout profile" ON public.payout_profiles;
CREATE POLICY "Users can delete their payout profile"
  ON public.payout_profiles FOR DELETE
  USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS set_payout_profiles_updated_at ON public.payout_profiles;
CREATE TRIGGER set_payout_profiles_updated_at
  BEFORE UPDATE ON public.payout_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.payout_profiles IS 'Safe payout metadata only. Never store raw bank credentials; provider onboarding supplies provider_account_id.';
