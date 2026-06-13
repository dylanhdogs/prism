-- 014_expense_receipts.sql
-- Adds one private receipt attachment per expense.

INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE TABLE IF NOT EXISTS public.expense_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0),
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (expense_id),
  CHECK (file_type LIKE 'image/%' OR file_type = 'application/pdf')
);

ALTER TABLE public.expense_receipts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_expense_receipts_expense_id ON public.expense_receipts(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_receipts_group_id ON public.expense_receipts(group_id);

DROP POLICY IF EXISTS "Group members can view receipts" ON public.expense_receipts;
CREATE POLICY "Group members can view receipts"
  ON public.expense_receipts
  FOR SELECT
  USING (public.is_group_member(group_id));

DROP POLICY IF EXISTS "Group owners can create receipts" ON public.expense_receipts;
CREATE POLICY "Group owners can create receipts"
  ON public.expense_receipts
  FOR INSERT
  WITH CHECK (
    uploaded_by = auth.uid()
    AND public.is_group_admin(group_id)
    AND EXISTS (
      SELECT 1
      FROM public.expenses
      WHERE expenses.id = expense_receipts.expense_id
        AND expenses.group_id = expense_receipts.group_id
    )
  );

DROP POLICY IF EXISTS "Group owners can update receipts" ON public.expense_receipts;
CREATE POLICY "Group owners can update receipts"
  ON public.expense_receipts
  FOR UPDATE
  USING (public.is_group_admin(group_id))
  WITH CHECK (public.is_group_admin(group_id));

DROP POLICY IF EXISTS "Group owners can delete receipts" ON public.expense_receipts;
CREATE POLICY "Group owners can delete receipts"
  ON public.expense_receipts
  FOR DELETE
  USING (public.is_group_admin(group_id));

DROP POLICY IF EXISTS "Group members can view receipt files" ON storage.objects;
CREATE POLICY "Group members can view receipt files"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'receipts'
    AND CASE
      WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN public.is_group_member((storage.foldername(name))[1]::UUID)
      ELSE false
    END
  );

DROP POLICY IF EXISTS "Group owners can upload receipt files" ON storage.objects;
CREATE POLICY "Group owners can upload receipt files"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'receipts'
    AND CASE
      WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN public.is_group_admin((storage.foldername(name))[1]::UUID)
      ELSE false
    END
  );

DROP POLICY IF EXISTS "Group owners can update receipt files" ON storage.objects;
CREATE POLICY "Group owners can update receipt files"
  ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'receipts'
    AND CASE
      WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN public.is_group_admin((storage.foldername(name))[1]::UUID)
      ELSE false
    END
  )
  WITH CHECK (
    bucket_id = 'receipts'
    AND CASE
      WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN public.is_group_admin((storage.foldername(name))[1]::UUID)
      ELSE false
    END
  );

DROP POLICY IF EXISTS "Group owners can delete receipt files" ON storage.objects;
CREATE POLICY "Group owners can delete receipt files"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'receipts'
    AND CASE
      WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN public.is_group_admin((storage.foldername(name))[1]::UUID)
      ELSE false
    END
  );

CREATE TRIGGER set_expense_receipts_updated_at
  BEFORE UPDATE ON public.expense_receipts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.expense_receipts IS 'Receipt metadata for one private image or PDF receipt per expense. Files live in the private Supabase Storage bucket named receipts.';
