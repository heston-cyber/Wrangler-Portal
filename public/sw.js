// Phase 5e step 4 (Nov 5): phone alerts. Shows each Web Push alert and opens the portal page it names when tapped.
// It caches nothing: the portal always loads fresh from the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  const url = typeof d.url === "string" && d.url.startsWith("/") ? d.url : "/notifications";
  e.waitUntil(self.registration.showNotification(d.title || "Wrangler Portal", {
    body: d.body || "", tag: d.tag || undefined, data: { url }, icon: "/brand/app-icon-192.png", badge: "/brand/app-icon-192.png",
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/notifications", self.location.origin).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const same = all.find((c) => new URL(c.url).origin === self.location.origin);
    if (same) { await same.focus(); if ("navigate" in same) await same.navigate(url); return; }
    await self.clients.openWindow(url);
  })());
});
