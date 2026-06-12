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
