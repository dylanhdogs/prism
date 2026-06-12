type Env = {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
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

export default {
  async fetch(request: Request, env: Env) {
    return env.ASSETS.fetch(rewriteAssetRequest(request));
  },
};
