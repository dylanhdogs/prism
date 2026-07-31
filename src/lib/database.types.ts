export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Profile, 'id'>>;
      };
      groups: {
        Row: Group;
        Insert: Omit<Group, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Group, 'id'>>;
      };
      group_members: {
        Row: GroupMember;
        Insert: Omit<GroupMember, 'id' | 'created_at'>;
        Update: Partial<Omit<GroupMember, 'id'>>;
      };
      expenses: {
        Row: Expense;
        Insert: Omit<Expense, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Expense, 'id'>>;
      };
      expense_splits: {
        Row: ExpenseSplit;
        Insert: Omit<ExpenseSplit, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<ExpenseSplit, 'id'>>;
      };
      expense_receipts: {
        Row: ExpenseReceipt;
        Insert: Omit<ExpenseReceipt, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<ExpenseReceipt, 'id'>>;
      };
      receipt_items: {
        Row: ReceiptItem;
        Insert: Omit<ReceiptItem, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<ReceiptItem, 'id'>>;
      };
      receipt_item_claims: {
        Row: ReceiptItemClaim;
        Insert: Omit<ReceiptItemClaim, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<ReceiptItemClaim, 'id'>>;
      };
      receipt_payment_methods: {
        Row: ReceiptPaymentMethod;
        Insert: Omit<ReceiptPaymentMethod, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<ReceiptPaymentMethod, 'id'>>;
      };
      receipt_payment_requests: {
        Row: ReceiptPaymentRequest;
        Insert: Omit<ReceiptPaymentRequest, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<ReceiptPaymentRequest, 'id'>>;
      };
      settlements: {
        Row: Settlement;
        Insert: Omit<Settlement, 'id' | 'created_at'>;
        Update: Partial<Omit<Settlement, 'id'>>;
      };
      invitations: {
        Row: Invitation;
        Insert: Omit<Invitation, 'id' | 'created_at' | 'invited_email' | 'status' | 'opened_at' | 'guest_session_expires_at' | 'guest_claim_token_hash'> & {
          invited_email?: string | null;
          status?: string;
          opened_at?: string | null;
          guest_session_expires_at?: string | null;
          guest_claim_token_hash?: string | null;
        };
        Update: Partial<Omit<Invitation, 'id'>>;
      };
      guest_sessions: {
        Row: GuestSession;
        Insert: Omit<GuestSession, 'id' | 'created_at' | 'last_seen_at' | 'revoked_at'> & { last_seen_at?: string | null; revoked_at?: string | null };
        Update: Partial<Omit<GuestSession, 'id'>>;
      };
      activity_logs: {
        Row: ActivityLog;
        Insert: Omit<ActivityLog, 'id' | 'created_at'>;
        Update: Partial<Omit<ActivityLog, 'id'>>;
      };
    };
    Views: Record<string, unknown>;
    Functions: Record<string, unknown>;
    Enums: Record<string, unknown>;
  };
}

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string | null;
  invited_email: string | null;
  display_name: string | null;
  role: string;
  status: string;
  created_at: string;
}

export interface Expense {
  id: string;
  group_id: string;
  paid_by_member_id: string;
  title: string;
  description: string | null;
  amount: number;
  expense_date: string;
  split_type: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ExpenseSplit {
  id: string;
  expense_id: string;
  member_id: string;
  amount_owed: number;
  is_settled: boolean;
  allocation_source: string;
  subtotal_amount: number;
  tax_amount: number;
  tip_amount: number;
  service_charge_amount: number;
  discount_amount: number;
  created_at: string;
  updated_at: string;
}

export interface ExpenseReceipt {
  id: string;
  expense_id: string;
  group_id: string;
  file_path: string;
  file_name: string;
  file_type: string;
  file_size: number;
  uploaded_by: string;
  extraction_status: string;
  merchant_name: string | null;
  subtotal_amount: number | null;
  tax_amount: number;
  tip_amount: number;
  service_charge_amount: number;
  discount_amount: number;
  total_amount: number | null;
  tax_allocation_method: string;
  tip_allocation_method: string;
  service_charge_allocation_method: string;
  discount_allocation_method: string;
  ocr_payload: Record<string, unknown> | null;
  extracted_at: string | null;
  corrected_at: string | null;
  corrected_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReceiptItem {
  id: string;
  expense_receipt_id: string;
  expense_id: string;
  group_id: string;
  line_number: number | null;
  name: string;
  description: string | null;
  quantity: number;
  unit_price: number | null;
  subtotal_amount: number;
  status: string;
  owner_notes: string | null;
  extracted_metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface ReceiptItemClaim {
  id: string;
  receipt_item_id: string;
  expense_id: string;
  group_id: string;
  member_id: string;
  claim_quantity: number;
  claim_amount_override: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ReceiptPaymentMethod {
  id: string;
  group_id: string;
  owner_member_id: string;
  owner_user_id: string;
  method_type: string;
  display_name: string;
  handle: string | null;
  payment_url: string | null;
  instructions: string | null;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReceiptPaymentRequest {
  id: string;
  expense_split_id: string;
  expense_id: string;
  group_id: string;
  from_member_id: string;
  to_member_id: string;
  selected_payment_method_id: string | null;
  amount_requested: number;
  amount_sent: number | null;
  status: string;
  payment_reference: string | null;
  member_note: string | null;
  owner_note: string | null;
  payment_sent_at: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Settlement {
  id: string;
  group_id: string;
  from_member_id: string;
  to_member_id: string;
  amount: number;
  status: string;
  settled_at: string;
  created_at: string;
}

export interface Invitation {
  id: string;
  group_id: string;
  invited_email: string | null;
  invited_by: string;
  token: string;
  status: string;
  expires_at: string;
  opened_at: string | null;
  guest_session_expires_at: string | null;
  guest_claim_token_hash: string | null;
  created_at: string;
}

export interface GuestSession {
  id: string;
  invitation_id: string;
  group_member_id: string | null;
  guest_name: string;
  session_token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  last_seen_at: string | null;
}

export interface ActivityLog {
  id: string;
  group_id: string;
  user_id: string;
  action: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
