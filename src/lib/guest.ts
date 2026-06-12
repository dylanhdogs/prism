export async function openGuestInvite(token: string) {
  const response = await fetch(`/api/invite/${encodeURIComponent(token)}`, {
    credentials: 'include',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Unable to open invite.');
  return data;
}

export async function createGuestSession(token: string, guestName: string) {
  const response = await fetch(`/api/invite/${encodeURIComponent(token)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ guestName }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Unable to create guest session.');
  return data;
}

export async function getGuestGroup() {
  const response = await fetch('/api/guest/group', { credentials: 'include' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Unable to load guest group.');
  return data;
}
