// Phase 5e step 4 (Nov 5): phone alerts in the browser. The portal's service worker (public/sw.js) shows them; this
// file turns them on and off for this device and says which state it's in for Settings › Notifications.
export type PhoneState = "unsupported" | "install" | "blocked" | "off" | "on";

const ua = () => (typeof navigator === "undefined" ? "" : navigator.userAgent);
export const isIOS = () => /iPhone|iPad|iPod/.test(ua()) || (/Macintosh/.test(ua()) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/.test(ua());
export const isPhone = () => isIOS() || isAndroid();
/** Opened from its home-screen icon (alerts on an iPhone only work from there). */
export const isInstalled = () =>
  (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches) || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const canPush = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** "iPhone · Safari", "Mac · Chrome" */
export function deviceLabel() {
  const u = ua();
  const os = /iPhone/.test(u) ? "iPhone" : /iPad/.test(u) || isIOS() && /Macintosh/.test(u) ? "iPad" : /Android/.test(u) ? "Android" : /Mac OS X/.test(u) ? "Mac" : /Windows/.test(u) ? "Windows" : "This device";
  const br = /Edg\//.test(u) ? "Edge" : /Firefox|FxiOS/.test(u) ? "Firefox" : /CriOS|Chrome\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : "Browser";
  return `${os} · ${br}`;
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
}

/** This device's alert address, if it has one. */
export async function currentEndpoint(): Promise<string | null> {
  if (!canPush()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription())?.endpoint ?? null;
}

export async function phoneState(): Promise<PhoneState> {
  if (isIOS() && !isInstalled()) return "install";
  if (!canPush()) return isPhone() ? "install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return (await currentEndpoint()) ? "on" : "off";
}

const b64 = (s: string) => { const p = "=".repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
const enc = (b: ArrayBuffer | null) => (b ? btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : "");

/** Asks the phone (its own prompt), then makes this device's alert address. Null if the person said no. */
export async function turnOn(publicKey: string): Promise<{ endpoint: string; p256dh: string; auth: string; label: string } | null> {
  if (!canPush()) return null;
  if ((await Notification.requestPermission()) !== "granted") return null;
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(publicKey) }));
  return { endpoint: sub.endpoint, p256dh: enc(sub.getKey("p256dh")), auth: enc(sub.getKey("auth")), label: deviceLabel() };
}

export async function turnOff(): Promise<string | null> {
  if (!canPush()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}

/** Keeps the service worker registered for anyone who turned alerts on (so a tap opens the portal). */
export function registerWorker() {
  if (canPush() && Notification.permission === "granted") void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
}
