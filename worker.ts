type Env = {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  MINDEE_API_KEY?: string;
  MINDEE_RECEIPT_ENDPOINT?: string;
  STRIPE_SECRET_KEY?: string;
  APP_URL?: string;
};

function getSupabaseConfig(env: Env) {
  return {
    url: env.SUPABASE_URL || env.VITE_SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY,
  };
}

async function getAuthenticatedUser(request: Request, env: Env) {
  const authorization = request.headers.get('Authorization');
  const supabase = getSupabaseConfig(env);
  if (!authorization || !supabase.url || !supabase.anonKey) return null;
  const response = await fetch(`${supabase.url}/auth/v1/user`, {
    headers: {
      apikey: supabase.anonKey,
      Authorization: authorization,
    },
  });
  if (!response.ok) return null;
  return response.json() as Promise<{ id: string }>;
}

async function isExpenseOwner(expenseId: string, userId: string, request: Request, env: Env) {
  const supabase = getSupabaseConfig(env);
  if (!supabase.url || !supabase.anonKey) return false;
  const authorization = request.headers.get('Authorization');
  const response = await fetch(`${supabase.url}/rest/v1/expenses?id=eq.${encodeURIComponent(expenseId)}&created_by=eq.${encodeURIComponent(userId)}&select=id`, {
    headers: {
      apikey: supabase.anonKey,
      Authorization: authorization || '',
    },
  });
  if (!response.ok) return false;
  const rows = await response.json() as unknown[];
  return rows.length > 0;
}

function unauthorized() {
  return Response.json({ error: 'Authentication required.' }, { status: 401 });
}

function parseMoney(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function normalizeReceiptExtraction(payload: any) {
  const prediction = payload?.document?.inference?.prediction
    || payload?.document?.inference?.result
    || payload?.document?.result
    || payload?.result
    || {};
  const fieldValue = (field: any) => field?.value ?? field?.content ?? field ?? null;
  const lineItems = fieldValue(prediction.line_items) || fieldValue(prediction.items) || [];
  const items = (Array.isArray(lineItems) ? lineItems : []).map((entry: any, index: number) => {
    const fields = entry?.fields || entry?.value || entry || {};
    const name = fieldValue(fields.description) || fieldValue(fields.product_name) || fieldValue(fields.name) || `Item ${index + 1}`;
    const quantity = parseMoney(fieldValue(fields.quantity)) || 1;
    const unitPrice = parseMoney(fieldValue(fields.unit_price) || fieldValue(fields.unitPrice));
    const total = parseMoney(fieldValue(fields.total_amount) || fieldValue(fields.total) || fieldValue(fields.amount)) || parseMoney(quantity * unitPrice);
    return {
      name: String(name),
      quantity,
      unit_price: unitPrice || null,
      subtotal_amount: total,
      line_number: index + 1,
    };
  }).filter((item: any) => item.name && item.subtotal_amount >= 0);

  return {
    merchant_name: fieldValue(prediction.merchant_name) || fieldValue(prediction.supplier_name) || null,
    subtotal_amount: parseMoney(fieldValue(prediction.subtotal) || fieldValue(prediction.subtotal_amount)) || null,
    tax_amount: parseMoney(fieldValue(prediction.total_tax) || fieldValue(prediction.tax)),
    total_amount: parseMoney(fieldValue(prediction.total_amount) || fieldValue(prediction.total)) || null,
    items,
    raw: payload,
  };
}

async function handleReceiptParse(request: Request, env: Env) {
  const user = await getAuthenticatedUser(request, env);
  if (!user) return unauthorized();
  if (!env.MINDEE_API_KEY) return Response.json({ error: 'Receipt OCR is not configured yet.' }, { status: 503 });

  const form = await request.formData();
  const expenseId = String(form.get('expenseId') || '');
  const file = form.get('file');
  if (!expenseId || !(file instanceof File)) return Response.json({ error: 'Receipt file and expense are required.' }, { status: 400 });
  if (!(await isExpenseOwner(expenseId, user.id, request, env))) return Response.json({ error: 'Only the receipt owner can extract this receipt.' }, { status: 403 });

  const body = new FormData();
  body.append('document', file, file.name);
  const endpoint = env.MINDEE_RECEIPT_ENDPOINT || 'https://api.mindee.net/v1/products/mindee/expense_receipts/v3/predict';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Token ${env.MINDEE_API_KEY}` },
    body,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) return Response.json({ error: payload?.api_request?.error?.message || 'Receipt OCR failed.' }, { status: 502 });
  return Response.json(normalizeReceiptExtraction(payload));
}

async function supabaseUserRequest(path: string, request: Request, env: Env, init: RequestInit = {}) {
  const supabase = getSupabaseConfig(env);
  const authorization = request.headers.get('Authorization') || '';
  return fetch(`${supabase.url}${path}`, {
    ...init,
    headers: {
      apikey: supabase.anonKey || '',
      Authorization: authorization,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

async function stripeRequest(path: string, env: Env, body: URLSearchParams) {
  return fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
}

async function handlePayoutOnboarding(request: Request, env: Env) {
  const user = await getAuthenticatedUser(request, env);
  if (!user) return unauthorized();
  const supabase = getSupabaseConfig(env);
  if (!env.STRIPE_SECRET_KEY || !supabase.url || !supabase.anonKey) return Response.json({ error: 'Payout onboarding is not configured yet.' }, { status: 503 });

  const profileResponse = await supabaseUserRequest(`/rest/v1/payout_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=provider_account_id`, request, env);
  const profiles = await profileResponse.json() as { provider_account_id: string | null }[];
  let accountId = profiles[0]?.provider_account_id || '';
  if (!accountId) {
    const accountResponse = await stripeRequest('accounts', env, new URLSearchParams({ type: 'express', 'capabilities[transfers][requested]': 'true' }));
    const account = await accountResponse.json() as { id?: string; error?: { message?: string } };
    if (!accountResponse.ok || !account.id) return Response.json({ error: account.error?.message || 'Unable to create payout account.' }, { status: 502 });
    accountId = account.id;
    await supabaseUserRequest('/rest/v1/payout_profiles', request, env, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: user.id, method_type: 'bank_transfer', display_name: 'My receiving account', provider_account_id: accountId, status: 'pending_provider' }),
    });
  }

  const appUrl = (env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
  const linkResponse = await stripeRequest('account_links', env, new URLSearchParams({ account: accountId, type: 'account_onboarding', refresh_url: `${appUrl}/dashboard?stripe=refresh`, return_url: `${appUrl}/dashboard?stripe=complete` }));
  const link = await linkResponse.json() as { url?: string; error?: { message?: string } };
  if (!linkResponse.ok || !link.url) return Response.json({ error: link.error?.message || 'Unable to start payout onboarding.' }, { status: 502 });
  return Response.json({ url: link.url });
}

function rewriteAssetRequest(request: Request) {
  const url = new URL(request.url);
  const rewrites: Record<string, string> = {
    '/login': '/login.html',
    '/signup': '/signup.html',
    '/confirm-account': '/confirm-account.html',
    '/forgot-password': '/forgot-password.html',
    '/update-password': '/update-password.html',
    '/dashboard': '/dashboard.html',
    '/groups': '/groups.html',
    '/guest': '/guest.html',
    '/blog': '/blog.html',
    '/about': '/about.html',
    '/help': '/help.html',
    '/privacy': '/privacy.html',
    '/contact': '/contact.html',
    '/terms': '/terms.html',
  };

  if (url.pathname.startsWith('/invite/')) url.pathname = '/invite.html';
  else if (rewrites[url.pathname]) url.pathname = rewrites[url.pathname];
  else return request;

  return new Request(url.toString(), request);
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function handleSendInvite(request: Request, env: Env) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    return Response.json(
      { error: 'Invite email setup is missing. Set RESEND_API_KEY and RESEND_FROM_EMAIL.' },
      { status: 500 },
    );
  }

  let body: { recipientEmail?: string; inviteLink?: string; groupName?: string } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const recipientEmail = body.recipientEmail?.trim();
  const inviteLink = body.inviteLink?.trim();
  const groupName = body.groupName?.trim() || 'PRISM group';

  if (!recipientEmail || !recipientEmail.includes('@')) {
    return Response.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  if (!inviteLink) {
    return Response.json({ error: 'Missing invite link.' }, { status: 400 });
  }

  let parsedInviteUrl: URL;
  try {
    parsedInviteUrl = new URL(inviteLink);
  } catch {
    return Response.json({ error: 'Invite link is not valid.' }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  if (parsedInviteUrl.origin !== origin) {
    return Response.json({ error: 'Invite link must use this site address.' }, { status: 400 });
  }

  const subject = `You're invited to join ${groupName} on PRISM`;
  const text = [
    `You have been invited to join ${groupName} on PRISM.`,
    '',
    `Open this link to view the invite: ${inviteLink}`,
    '',
    'If the button does not work, paste the link into your browser.',
  ].join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;background:#f9fafb;padding:24px;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;border:1px solid #e5e7eb;">
        <h1 style="margin:0 0 16px;font-size:24px;color:#0f172a;">You have been invited to PRISM</h1>
        <p style="margin:0 0 16px;">You were invited to join <strong>${escapeHtml(groupName)}</strong>.</p>
        <p style="margin:0 0 24px;">Use the button below to open your invite.</p>
        <p style="margin:0 0 24px;">
          <a href="${escapeHtml(inviteLink)}" style="display:inline-block;background:#4f6ef7;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">Open invite</a>
        </p>
        <p style="margin:0;color:#6b7280;font-size:13px;word-break:break-word;">${escapeHtml(inviteLink)}</p>
      </div>
    </div>
  `;

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [recipientEmail],
      subject,
      text,
      html,
    }),
  });

  const payload = await resendResponse.json().catch(() => null);
  if (!resendResponse.ok) {
    return Response.json(
      { error: payload?.message || 'Unable to send the invite email.' },
      { status: resendResponse.status || 500 },
    );
  }

  return Response.json({ ok: true });
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/send-invite' && request.method === 'POST') {
      return handleSendInvite(request, env);
    }
    if (url.pathname === '/api/receipt/parse' && request.method === 'POST') {
      return handleReceiptParse(request, env);
    }
    if (url.pathname === '/api/payout/onboarding' && request.method === 'POST') {
      return handlePayoutOnboarding(request, env);
    }

    return env.ASSETS.fetch(rewriteAssetRequest(request));
  },
};
