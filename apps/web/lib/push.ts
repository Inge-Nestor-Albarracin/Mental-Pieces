// Web Push in the browser. The service worker (/sw.js) shows the notifications; this
// module asks for permission, subscribes and keeps the API informed. Nothing personal
// is stored on the device: the subscription lives in the browser's push manager.
import {
  getPushConfig,
  removePushSubscription,
  savePushSubscription,
  type PushSubscriptionPayload,
} from './api';
import { arrayBufferToBase64Url, urlBase64ToUint8Array } from './push-keys';

export type PushSupport =
  | 'supported'
  // iPhone/iPad: push only works once the app is installed on the home screen.
  | 'needs-install'
  | 'unsupported';

const DISMISS_KEY = 'mp-push-prompt-dismissed-until';
const DISMISS_DAYS = 7;

export function toPayload(subscription: PushSubscription): PushSubscriptionPayload {
  return {
    endpoint: subscription.endpoint,
    p256dh: arrayBufferToBase64Url(subscription.getKey('p256dh')),
    auth: arrayBufferToBase64Url(subscription.getKey('auth')),
  };
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  const capable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (capable) return 'supported';
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !isStandalone() ? 'needs-install' : 'unsupported';
}

const REGISTRATION_WAIT_MS = 5000;

// The service worker is registered in production only (components/pwa.tsx), by an effect
// of the root layout that runs AFTER the portal's effects on a first visit: wait briefly
// for it instead of concluding there is none. In development `ready` never resolves.
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), REGISTRATION_WAIT_MS); });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function hasServiceWorker(): Promise<boolean> {
  return (await registration()) !== null;
}

// Must run from a click: browsers block or hide permission prompts without a user gesture.
export async function enablePush(token: string): Promise<NotificationPermission> {
  const config = await getPushConfig(token);
  if (!config.enabled || !config.publicKey) throw new Error('Las notificaciones no están disponibles en este momento.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission;
  await syncPushSubscription(token, config.publicKey);
  return permission;
}

// Permission already granted: make sure this browser is subscribed and registered for the
// signed-in account (a previous account on this device is replaced by the API).
export async function syncPushSubscription(token: string, publicKey?: string): Promise<boolean> {
  if (pushSupport() !== 'supported' || Notification.permission !== 'granted') return false;
  const worker = await registration();
  if (!worker) return false;
  let key = publicKey;
  if (!key) {
    const config = await getPushConfig(token);
    if (!config.enabled || !config.publicKey) return false;
    key = config.publicKey;
  }
  const ready = await navigator.serviceWorker.ready;
  let subscription = await ready.pushManager.getSubscription();
  if (!subscription) {
    subscription = await ready.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
  }
  await savePushSubscription(token, toPayload(subscription));
  return true;
}

// Logout: this device must stop receiving the account's notifications.
export async function disablePushForLogout(token: string | null): Promise<void> {
  try {
    // No waiting here: without a registration there is no subscription to remove.
    if (!('serviceWorker' in navigator)) return;
    const worker = await navigator.serviceWorker.getRegistration('/');
    const subscription = await worker?.pushManager.getSubscription();
    if (!subscription) return;
    if (token) await removePushSubscription(token, subscription.endpoint).catch(() => undefined);
    await subscription.unsubscribe();
  } catch {
    // Logging out must never fail because of push.
  }
}

export function isPromptDismissed(now = Date.now()): boolean {
  try {
    const until = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Number.isFinite(until) && until > now;
  } catch {
    return false;
  }
}

export function dismissPrompt(now = Date.now()): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(now + DISMISS_DAYS * 24 * 60 * 60 * 1000));
  } catch {
    // Private mode: the prompt simply shows again next time.
  }
}
