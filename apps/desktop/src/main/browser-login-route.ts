export type BrowserLoginRoute = {
  name: string;
  loginUrl: string;
  sessionReturn: 'pinterest' | null;
};

/** Routing is not cookie permission. Never forward another session's OAuth state. */
export function browserLoginRoute(source: string): BrowserLoginRoute | null {
  let url: URL;
  try { url = new URL(source); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (url.hostname === 'accounts.google.com') return null;
  if (['pinterest.com', 'www.pinterest.com'].includes(url.hostname)) {
    return { name: 'Pinterest', loginUrl: 'https://www.pinterest.com/login/', sessionReturn: 'pinterest' };
  }
  if (['dribbble.com', 'www.dribbble.com'].includes(url.hostname)) {
    return { name: 'Dribbble', loginUrl: 'https://dribbble.com/session/new', sessionReturn: null };
  }
  if (['behance.net', 'www.behance.net'].includes(url.hostname)) {
    return { name: 'Behance', loginUrl: 'https://www.behance.net/', sessionReturn: null };
  }
  if (url.hostname === 'auth.services.adobe.com') {
    const clients = url.searchParams.getAll('client_id');
    return clients.length === 1 && clients[0] === 'BehanceWebSusi1'
      ? { name: 'Behance', loginUrl: 'https://www.behance.net/', sessionReturn: null }
      : null;
  }
  return { name: url.hostname, loginUrl: `${url.origin}/`, sessionReturn: null };
}
