type Env = {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
};

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

    return env.ASSETS.fetch(rewriteAssetRequest(request));
  },
};
