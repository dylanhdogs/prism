-- 003_expenses.sql
-- Creates expenses and expense_splits tables.

CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  paid_by_member_id UUID NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  split_type TEXT NOT NULL DEFAULT 'equal' CHECK (split_type IN ('equal', 'custom')),
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.expense_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  amount_owed NUMERIC(12,2) NOT NULL CHECK (amount_owed >= 0),
  is_settled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_splits ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_expenses_group_id ON public.expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_expenses_paid_by ON public.expenses(paid_by_member_id);
CREATE INDEX IF NOT EXISTS idx_expense_splits_expense_id ON public.expense_splits(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_splits_member_id ON public.expense_splits(member_id);

-- RLS: Expenses
CREATE POLICY "Members can view group expenses"
  ON public.expenses
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_members.group_id = expenses.group_id
        AND group_members.user_id = auth.uid()
        AND group_members.status = 'active'
    )
  );

CREATE POLICY "Members can create expenses in their groups"
  ON public.expenses
  FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_members.group_id = expenses.group_id
        AND group_members.user_id = auth.uid()
        AND group_members.status = 'active'
    )
  );

CREATE POLICY "Expense creators or admins can update"
  ON public.expenses
  FOR UPDATE
  USING (
    auth.uid() = created_by
    OR EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_members.group_id = expenses.group_id
        AND group_members.user_id = auth.uid()
        AND group_members.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Expense creators or admins can delete"
  ON public.expenses
  FOR DELETE
  USING (
    auth.uid() = created_by
    OR EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_members.group_id = expenses.group_id
        AND group_members.user_id = auth.uid()
        AND group_members.role IN ('owner', 'admin')
    )
  );

-- RLS: Expense Splits
CREATE POLICY "Members can view expense splits"
  ON public.expense_splits
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses
      JOIN public.group_members ON group_members.group_id = expenses.group_id
      WHERE expenses.id = expense_splits.expense_id
        AND group_members.user_id = auth.uid()
        AND group_members.status = 'active'
    )
  );

CREATE POLICY "Members can create splits"
  ON public.expense_splits
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses
      JOIN public.group_members ON group_members.group_id = expenses.group_id
      WHERE expenses.id = expense_splits.expense_id
        AND group_members.user_id = auth.uid()
        AND group_members.status = 'active'
    )
  );

CREATE POLICY "Members can update splits"
  ON public.expense_splits
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses
      JOIN public.group_members ON group_members.group_id = expenses.group_id
      WHERE expenses.id = expense_splits.expense_id
        AND group_members.user_id = auth.uid()
        AND group_members.status = 'active'
    )
  );

-- Triggers
CREATE TRIGGER set_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_expense_splits_updated_at
  BEFORE UPDATE ON public.expense_splits
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
