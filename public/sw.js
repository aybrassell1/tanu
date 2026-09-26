/*
 * Offline shell for the home-screen app.
 *
 * Pages are network-first so a new build is picked up as soon as it's
 * reachable, with the cached copy as the offline fallback. Hashed bundle
 * assets are cache-first because their URL changes when they change.
 *
 * The ledger itself never goes through here: it lives in localStorage on the
 * device and is never fetched or sent anywhere.
 */
const VERSION = 'tanu-v1';
const SHELL = `${VERSION}-shell`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(['./', './manifest.json']).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isAsset = url.pathname.includes('/_expo/') || url.pathname.includes('/assets/');
  if (isAsset) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(SHELL).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(SHELL).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit ?? caches.match('./'))),
  );
});

/*
 * Notifications.
 *
 * The server sends a title and a line of text and nothing else; the details
 * live on the device, which is where they came from. Tapping brings the app
 * forward if it is already open rather than stacking another copy.
 */
self.addEventListener('push', (event) => {
  let payload = { title: 'Tanu', body: 'Something new arrived.' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (e) {
    // A push we can't read is still worth surfacing.
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: './assets/apple-touch-icon.png',
      badge: './assets/apple-touch-icon.png',
      tag: 'tanu-transactions',
      data: { url: './' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? './', self.location.href).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    }),
  );
});
