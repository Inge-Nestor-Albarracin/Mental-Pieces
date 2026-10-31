// The server POSTs to whatever endpoint a browser registered, so an arbitrary URL would
// let a user make the API call internal or third-party hosts (SSRF). Only the push
// services of the major browsers are accepted.
const PUSH_SERVICE_HOSTS: (string | RegExp)[] = [
  'fcm.googleapis.com', // Chrome, Edge (Chromium), Opera, Samsung Internet
  'android.googleapis.com',
  /^updates(-autopush)?\.push\.services\.mozilla\.com$/, // Firefox
  'web.push.apple.com', // Safari / iOS home-screen apps
  /^[a-z0-9-]+\.notify\.windows\.com$/, // legacy Edge / Windows
];

const MAX_ENDPOINT_LENGTH = 1000;

export function isAllowedPushEndpoint(raw: string): boolean {
  if (typeof raw !== 'string' || raw.length > MAX_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((allowed) =>
    typeof allowed === 'string' ? host === allowed : allowed.test(host),
  );
}
