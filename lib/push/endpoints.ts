/**
 * Which push services we will talk to.
 *
 * A subscription's `endpoint` is a URL the browser hands us, and sending a
 * notification means our server POSTs to it. Without a check, anyone logged in
 * could register an address like `http://169.254.169.254/...` and have the
 * server call it. So only the real push services are accepted: Apple (iPhone
 * and Mac Safari), Google (Chrome and Android), Mozilla (Firefox) and
 * Microsoft (Edge), and only over https.
 */
const EXACT_HOSTS = new Set([
  'web.push.apple.com',
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
]);

const HOST_SUFFIXES = ['.notify.windows.com', '.push.apple.com'];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > 2048) return false;

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;

  const host = url.hostname.toLowerCase();
  return EXACT_HOSTS.has(host) || HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
