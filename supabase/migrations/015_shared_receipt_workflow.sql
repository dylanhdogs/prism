-- 015_shared_receipt_workflow.sql
-- Adds secure shared-receipt workflow tables, allocation metadata, and
-- receipt-specific payment tracking without removing legacy expense data.

CREATE OR REPLACE FUNCTION public.current_group_member_id(group_id UUID)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT group_members.id
  FROM public.group_members
  WHERE group_members.group_id = $1
    AND group_members.user_id = auth.uid()
    AND group_members.status = 'active'
  ORDER BY group_members.created_at ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_expense_owner(expense_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.expenses
    WHERE expenses.id = $1
      AND expenses.created_by = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_receipt_object(object_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT CASE
    WHEN array_length(storage.foldername(object_name), 1) >= 2
      AND (storage.foldername(object_name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.is_expense_owner((storage.foldername(object_name))[2]::UUID)
    ELSE false
  END;
$$;

ALTER TABLE public.expense_receipts
  ADD COLUMN IF NOT EXISTS extraction_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (extraction_status IN ('pending', 'processing', 'ready', 'needs_review', 'failed')),
  ADD COLUMN IF NOT EXISTS merchant_name TEXT,
  ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC(12,2) CHECK (subtotal_amount IS NULL OR subtotal_amount >= 0),
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  ADD COLUMN IF NOT EXISTS tip_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tip_amount >= 0),
  ADD COLUMN IF NOT EXISTS service_charge_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (service_charge_amount >= 0),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12,2) CHECK (total_amount IS NULL OR total_amount >= 0),
  ADD COLUMN IF NOT EXISTS tax_allocation_method TEXT NOT NULL DEFAULT 'proportional_subtotal'
    CHECK (tax_allocation_method IN ('proportional_subtotal', 'equal', 'owner_adjusted')),
  ADD COLUMN IF NOT EXISTS tip_allocation_method TEXT NOT NULL DEFAULT 'proportional_subtotal'
    CHECK (tip_allocation_method IN ('proportional_subtotal', 'equal', 'owner_adjusted')),
  ADD COLUMN IF NOT EXISTS service_charge_allocation_method TEXT NOT NULL DEFAULT 'proportional_subtotal'
    CHECK (service_charge_allocation_method IN ('proportional_subtotal', 'equal', 'owner_adjusted')),
  ADD COLUMN IF NOT EXISTS discount_allocation_method TEXT NOT NULL DEFAULT 'proportional_subtotal'
    CHECK (discount_allocation_method IN ('proportional_subtotal', 'equal', 'owner_adjusted')),
  ADD COLUMN IF NOT EXISTS ocr_payload JSONB,
  ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS corrected_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.expense_splits
  ADD COLUMN IF NOT EXISTS allocation_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (allocation_source IN ('manual', 'receipt')),
  ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  ADD COLUMN IF NOT EXISTS tip_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tip_amount >= 0),
  ADD COLUMN IF NOT EXISTS service_charge_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (service_charge_amount >= 0),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);

CREATE TABLE IF NOT EXISTS public.receipt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_receipt_id UUID NOT NULL REFERENCES public.expense_receipts(id) ON DELETE CASCADE,
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  line_number INTEGER,
  name TEXT NOT NULL,
  description TEXT,
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(12,2) CHECK (unit_price IS NULL OR unit_price >= 0),
  subtotal_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  owner_notes TEXT,
  extracted_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.receipt_item_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_item_id UUID NOT NULL REFERENCES public.receipt_items(id) ON DELETE CASCADE,
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  claim_quantity NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (claim_quantity > 0),
  claim_amount_override NUMERIC(12,2) CHECK (claim_amount_override IS NULL OR claim_amount_override >= 0),
  status TEXT NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed', 'released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (receipt_item_id, member_id)
);

CREATE TABLE IF NOT EXISTS public.receipt_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  owner_member_id UUID NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  method_type TEXT NOT NULL CHECK (method_type IN ('paypal', 'venmo', 'zelle', 'cash_app', 'custom_link')),
  display_name TEXT NOT NULL,
  handle TEXT,
  payment_url TEXT,
  instructions TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.receipt_payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_split_id UUID NOT NULL REFERENCES public.expense_splits(id) ON DELETE CASCADE,
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  from_member_id UUID NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  to_member_id UUID NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  selected_payment_method_id UUID REFERENCES public.receipt_payment_methods(id) ON DELETE SET NULL,
  amount_requested NUMERIC(12,2) NOT NULL CHECK (amount_requested >= 0),
  amount_sent NUMERIC(12,2) CHECK (amount_sent IS NULL OR amount_sent >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'payment_sent', 'confirmed', 'cancelled')),
  payment_reference TEXT,
  member_note TEXT,
  owner_note TEXT,
  payment_sent_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (expense_split_id),
  UNIQUE (expense_id, from_member_id)
);

ALTER TABLE public.receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_item_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_payment_requests ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt_id ON public.receipt_items(expense_receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_expense_id ON public.receipt_items(expense_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_group_id ON public.receipt_items(group_id);
CREATE INDEX IF NOT EXISTS idx_receipt_item_claims_item_id ON public.receipt_item_claims(receipt_item_id);
CREATE INDEX IF NOT EXISTS idx_receipt_item_claims_member_id ON public.receipt_item_claims(member_id);
CREATE INDEX IF NOT EXISTS idx_receipt_item_claims_group_id ON public.receipt_item_claims(group_id);
CREATE INDEX IF NOT EXISTS idx_receipt_payment_methods_owner_member_id ON public.receipt_payment_methods(owner_member_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_payment_methods_default_owner
  ON public.receipt_payment_methods(group_id, owner_member_id)
  WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_receipt_payment_requests_split_id ON public.receipt_payment_requests(expense_split_id);
CREATE INDEX IF NOT EXISTS idx_receipt_payment_requests_from_member_id ON public.receipt_payment_requests(from_member_id);
CREATE INDEX IF NOT EXISTS idx_receipt_payment_requests_to_member_id ON public.receipt_payment_requests(to_member_id);
CREATE INDEX IF NOT EXISTS idx_receipt_payment_requests_group_id ON public.receipt_payment_requests(group_id);

CREATE OR REPLACE FUNCTION public.set_receipt_item_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_receipt RECORD;
BEGIN
  SELECT expense_receipts.expense_id, expense_receipts.group_id
  INTO v_receipt
  FROM public.expense_receipts
  WHERE expense_receipts.id = NEW.expense_receipt_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not found.';
  END IF;

  NEW.expense_id := v_receipt.expense_id;
  NEW.group_id := v_receipt.group_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_receipt_item_claim_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_member_group_id UUID;
BEGIN
  SELECT receipt_items.expense_id, receipt_items.group_id
  INTO v_item
  FROM public.receipt_items
  WHERE receipt_items.id = NEW.receipt_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt item not found.';
  END IF;

  SELECT group_members.group_id
  INTO v_member_group_id
  FROM public.group_members
  WHERE group_members.id = NEW.member_id
    AND group_members.status = 'active';

  IF v_member_group_id IS NULL OR v_member_group_id <> v_item.group_id THEN
    RAISE EXCEPTION 'Claim member must be active in the same group.';
  END IF;

  NEW.expense_id := v_item.expense_id;
  NEW.group_id := v_item.group_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_receipt_payment_method_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_member RECORD;
BEGIN
  SELECT group_members.group_id, group_members.user_id
  INTO v_member
  FROM public.group_members
  WHERE group_members.id = NEW.owner_member_id
    AND group_members.status = 'active';

  IF NOT FOUND OR v_member.user_id IS NULL THEN
    RAISE EXCEPTION 'Payment methods require an authenticated active group member.';
  END IF;

  NEW.group_id := v_member.group_id;
  NEW.owner_user_id := v_member.user_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_receipt_payment_request_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_split RECORD;
  v_method_owner UUID;
  v_method_group UUID;
  v_method_active BOOLEAN;
BEGIN
  SELECT expense_splits.expense_id,
         expense_splits.member_id,
         expenses.group_id,
         expenses.paid_by_member_id
  INTO v_split
  FROM public.expense_splits
  JOIN public.expenses ON expenses.id = expense_splits.expense_id
  WHERE expense_splits.id = NEW.expense_split_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense split not found.';
  END IF;

  NEW.expense_id := v_split.expense_id;
  NEW.group_id := v_split.group_id;
  NEW.from_member_id := v_split.member_id;
  NEW.to_member_id := v_split.paid_by_member_id;

  IF NEW.selected_payment_method_id IS NOT NULL THEN
    SELECT receipt_payment_methods.owner_member_id,
           receipt_payment_methods.group_id,
           receipt_payment_methods.is_active
    INTO v_method_owner, v_method_group, v_method_active
    FROM public.receipt_payment_methods
    WHERE receipt_payment_methods.id = NEW.selected_payment_method_id;

    IF v_method_owner IS NULL THEN
      RAISE EXCEPTION 'Payment method not found.';
    END IF;

    IF v_method_group <> NEW.group_id OR v_method_owner <> NEW.to_member_id OR NOT v_method_active THEN
      RAISE EXCEPTION 'Selected payment method must belong to the receipt owner in the same group.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_receipt_payment_request_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_current_member_id UUID;
  v_is_owner BOOLEAN;
BEGIN
  v_is_owner := public.is_expense_owner(OLD.expense_id);

  IF v_is_owner THEN
    IF NEW.status = 'confirmed' AND NEW.confirmed_at IS NULL THEN
      NEW.confirmed_at := now();
    END IF;

    IF NEW.status = 'confirmed' AND NEW.confirmed_by IS NULL THEN
      NEW.confirmed_by := auth.uid();
    END IF;

    RETURN NEW;
  END IF;

  v_current_member_id := public.current_group_member_id(OLD.group_id);
  IF v_current_member_id IS NULL OR v_current_member_id <> OLD.from_member_id THEN
    RAISE EXCEPTION 'Only the receipt owner or the member who owes can update this payment request.';
  END IF;

  IF NEW.expense_split_id IS DISTINCT FROM OLD.expense_split_id
     OR NEW.expense_id IS DISTINCT FROM OLD.expense_id
     OR NEW.group_id IS DISTINCT FROM OLD.group_id
     OR NEW.from_member_id IS DISTINCT FROM OLD.from_member_id
     OR NEW.to_member_id IS DISTINCT FROM OLD.to_member_id
     OR NEW.amount_requested IS DISTINCT FROM OLD.amount_requested
     OR NEW.owner_note IS DISTINCT FROM OLD.owner_note
     OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
     OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by THEN
    RAISE EXCEPTION 'Members can only update their own payment-sent state.';
  END IF;

  IF NEW.status NOT IN ('pending', 'payment_sent') THEN
    RAISE EXCEPTION 'Members can only toggle between pending and payment sent.';
  END IF;

  IF NEW.status = 'payment_sent' THEN
    IF NEW.selected_payment_method_id IS NULL THEN
      RAISE EXCEPTION 'Choose a payment method before marking payment sent.';
    END IF;

    IF NEW.amount_sent IS NULL THEN
      NEW.amount_sent := OLD.amount_requested;
    END IF;

    IF NEW.payment_sent_at IS NULL THEN
      NEW.payment_sent_at := now();
    END IF;
  END IF;

  IF NEW.status = 'pending' THEN
    NEW.confirmed_at := NULL;
    NEW.confirmed_by := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_receipt_items_scope ON public.receipt_items;
CREATE TRIGGER set_receipt_items_scope
  BEFORE INSERT OR UPDATE ON public.receipt_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_receipt_item_scope();

DROP TRIGGER IF EXISTS set_receipt_item_claims_scope ON public.receipt_item_claims;
CREATE TRIGGER set_receipt_item_claims_scope
  BEFORE INSERT OR UPDATE ON public.receipt_item_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.set_receipt_item_claim_scope();

DROP TRIGGER IF EXISTS set_receipt_payment_methods_scope ON public.receipt_payment_methods;
CREATE TRIGGER set_receipt_payment_methods_scope
  BEFORE INSERT OR UPDATE ON public.receipt_payment_methods
  FOR EACH ROW
  EXECUTE FUNCTION public.set_receipt_payment_method_scope();

DROP TRIGGER IF EXISTS set_receipt_payment_requests_scope ON public.receipt_payment_requests;
CREATE TRIGGER set_receipt_payment_requests_scope
  BEFORE INSERT OR UPDATE ON public.receipt_payment_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_receipt_payment_request_scope();

DROP TRIGGER IF EXISTS enforce_receipt_payment_request_update ON public.receipt_payment_requests;
CREATE TRIGGER enforce_receipt_payment_request_update
  BEFORE UPDATE ON public.receipt_payment_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_receipt_payment_request_update();

DROP TRIGGER IF EXISTS set_receipt_items_updated_at ON public.receipt_items;
CREATE TRIGGER set_receipt_items_updated_at
  BEFORE UPDATE ON public.receipt_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_receipt_item_claims_updated_at ON public.receipt_item_claims;
CREATE TRIGGER set_receipt_item_claims_updated_at
  BEFORE UPDATE ON public.receipt_item_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_receipt_payment_methods_updated_at ON public.receipt_payment_methods;
CREATE TRIGGER set_receipt_payment_methods_updated_at
  BEFORE UPDATE ON public.receipt_payment_methods
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_receipt_payment_requests_updated_at ON public.receipt_payment_requests;
CREATE TRIGGER set_receipt_payment_requests_updated_at
  BEFORE UPDATE ON public.receipt_payment_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP POLICY IF EXISTS "Group owners can create receipts" ON public.expense_receipts;
CREATE POLICY "Receipt owners can create receipts"
  ON public.expense_receipts
  FOR INSERT
  WITH CHECK (
    uploaded_by = auth.uid()
    AND public.is_expense_owner(expense_id)
    AND EXISTS (
      SELECT 1
      FROM public.expenses
      WHERE expenses.id = expense_receipts.expense_id
        AND expenses.group_id = expense_receipts.group_id
    )
  );

DROP POLICY IF EXISTS "Group owners can update receipts" ON public.expense_receipts;
CREATE POLICY "Receipt owners can update receipts"
  ON public.expense_receipts
  FOR UPDATE
  USING (public.is_expense_owner(expense_id))
  WITH CHECK (public.is_expense_owner(expense_id));

DROP POLICY IF EXISTS "Group owners can delete receipts" ON public.expense_receipts;
CREATE POLICY "Receipt owners can delete receipts"
  ON public.expense_receipts
  FOR DELETE
  USING (public.is_expense_owner(expense_id));

DROP POLICY IF EXISTS "Group owners can upload receipt files" ON storage.objects;
CREATE POLICY "Receipt owners can upload receipt files"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'receipts'
    AND public.can_manage_receipt_object(name)
  );

DROP POLICY IF EXISTS "Group owners can update receipt files" ON storage.objects;
CREATE POLICY "Receipt owners can update receipt files"
  ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'receipts'
    AND public.can_manage_receipt_object(name)
  )
  WITH CHECK (
    bucket_id = 'receipts'
    AND public.can_manage_receipt_object(name)
  );

DROP POLICY IF EXISTS "Group owners can delete receipt files" ON storage.objects;
CREATE POLICY "Receipt owners can delete receipt files"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'receipts'
    AND public.can_manage_receipt_object(name)
  );

DROP POLICY IF EXISTS "Group members can view receipt items" ON public.receipt_items;
CREATE POLICY "Group members can view receipt items"
  ON public.receipt_items
  FOR SELECT
  USING (public.is_group_member(group_id));

DROP POLICY IF EXISTS "Receipt owners can manage receipt items" ON public.receipt_items;
CREATE POLICY "Receipt owners can manage receipt items"
  ON public.receipt_items
  FOR ALL
  USING (public.is_expense_owner(expense_id))
  WITH CHECK (public.is_expense_owner(expense_id));

DROP POLICY IF EXISTS "Group members can view receipt item claims" ON public.receipt_item_claims;
CREATE POLICY "Group members can view receipt item claims"
  ON public.receipt_item_claims
  FOR SELECT
  USING (public.is_group_member(group_id));

DROP POLICY IF EXISTS "Members can create their own receipt item claims" ON public.receipt_item_claims;
CREATE POLICY "Members can create their own receipt item claims"
  ON public.receipt_item_claims
  FOR INSERT
  WITH CHECK (member_id = public.current_group_member_id(group_id));

DROP POLICY IF EXISTS "Members can update their own receipt item claims" ON public.receipt_item_claims;
CREATE POLICY "Members can update their own receipt item claims"
  ON public.receipt_item_claims
  FOR UPDATE
  USING (member_id = public.current_group_member_id(group_id))
  WITH CHECK (member_id = public.current_group_member_id(group_id));

DROP POLICY IF EXISTS "Members can delete their own receipt item claims" ON public.receipt_item_claims;
CREATE POLICY "Members can delete their own receipt item claims"
  ON public.receipt_item_claims
  FOR DELETE
  USING (member_id = public.current_group_member_id(group_id));

DROP POLICY IF EXISTS "Group members can view receipt payment methods" ON public.receipt_payment_methods;
CREATE POLICY "Group members can view receipt payment methods"
  ON public.receipt_payment_methods
  FOR SELECT
  USING (public.is_group_member(group_id));

DROP POLICY IF EXISTS "Owners can create their own receipt payment methods" ON public.receipt_payment_methods;
CREATE POLICY "Owners can create their own receipt payment methods"
  ON public.receipt_payment_methods
  FOR INSERT
  WITH CHECK (owner_member_id = public.current_group_member_id(group_id));

DROP POLICY IF EXISTS "Owners can update their own receipt payment methods" ON public.receipt_payment_methods;
CREATE POLICY "Owners can update their own receipt payment methods"
  ON public.receipt_payment_methods
  FOR UPDATE
  USING (owner_member_id = public.current_group_member_id(group_id))
  WITH CHECK (owner_member_id = public.current_group_member_id(group_id));

DROP POLICY IF EXISTS "Owners can delete their own receipt payment methods" ON public.receipt_payment_methods;
CREATE POLICY "Owners can delete their own receipt payment methods"
  ON public.receipt_payment_methods
  FOR DELETE
  USING (owner_member_id = public.current_group_member_id(group_id));

DROP POLICY IF EXISTS "Group members can view receipt payment requests" ON public.receipt_payment_requests;
CREATE POLICY "Group members can view receipt payment requests"
  ON public.receipt_payment_requests
  FOR SELECT
  USING (public.is_group_member(group_id));

DROP POLICY IF EXISTS "Receipt owners can create payment requests" ON public.receipt_payment_requests;
CREATE POLICY "Receipt owners can create payment requests"
  ON public.receipt_payment_requests
  FOR INSERT
  WITH CHECK (public.is_expense_owner(expense_id));

DROP POLICY IF EXISTS "Receipt owners or debt members can update payment requests" ON public.receipt_payment_requests;
CREATE POLICY "Receipt owners or debt members can update payment requests"
  ON public.receipt_payment_requests
  FOR UPDATE
  USING (
    public.is_expense_owner(expense_id)
    OR from_member_id = public.current_group_member_id(group_id)
  )
  WITH CHECK (
    public.is_expense_owner(expense_id)
    OR from_member_id = public.current_group_member_id(group_id)
  );

DROP POLICY IF EXISTS "Receipt owners can delete payment requests" ON public.receipt_payment_requests;
CREATE POLICY "Receipt owners can delete payment requests"
  ON public.receipt_payment_requests
  FOR DELETE
  USING (public.is_expense_owner(expense_id));

COMMENT ON TABLE public.receipt_items IS 'Owner-managed receipt line items for each uploaded receipt.';
COMMENT ON TABLE public.receipt_item_claims IS 'Per-member receipt item claims. Members may only change their own claim rows.';
COMMENT ON TABLE public.receipt_payment_methods IS 'Direct repayment methods a receipt owner exposes to group members.';
COMMENT ON TABLE public.receipt_payment_requests IS 'Receipt-specific payment state for each owing member, including selected owner payment method and owner confirmation.';
