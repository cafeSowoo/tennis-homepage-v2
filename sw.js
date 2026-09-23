const CACHE_PREFIX = "tennis-homepage-v2-";
const CACHE_NAME = `${CACHE_PREFIX}__CACHE_VERSION__`;
const APP_URL = new URL(self.registration.scope);

function isAppUrl(url) {
  return url.origin === APP_URL.origin && url.pathname.startsWith(APP_URL.pathname);
}

async function matchAppCache(request) {
  const cache = await caches.open(CACHE_NAME);
  return cache.match(request);
}
const SHELL_ASSETS = [
  "./manifest.webmanifest",
  "./assets/logo-192.webp",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/brand-wordmark.webp"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("notificationclick", event => {
  event.notification.close();

  let target = APP_URL;
  try {
    const candidate = new URL(event.notification.data?.url || "./", APP_URL);
    if (isAppUrl(candidate)) target = candidate;
  } catch { /* Fall back to this app for malformed notification URLs. */ }
  const targetUrl = target.href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
      const existingClient = clientList.find(client => isAppUrl(new URL(client.url)));
      if (existingClient) {
        existingClient.focus();
        return "navigate" in existingClient ? existingClient.navigate(targetUrl) : existingClient;
      }
      return clients.openWindow ? clients.openWindow(targetUrl) : undefined;
    })
  );
});

function isHtmlRequest(request) {
  return request.mode === "navigate" ||
    request.headers.get("accept")?.includes("text/html");
}

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!isAppUrl(url)) return;

  if (url.pathname.includes("/data/")) {
    event.respondWith(fetch(request));
    return;
  }

  if (url.pathname.endsWith("/env.js") || url.pathname.endsWith("env.js")) {
    event.respondWith(
      fetch(request).then(response => {
        if (response && response.status === 200 && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      }).catch(() => matchAppCache(request))
    );
    return;
  }

  if (isHtmlRequest(request)) {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await matchAppCache(request);
        return cached || matchAppCache(new URL("index.html", APP_URL).href);
      })
    );
    return;
  }

  event.respondWith(
    matchAppCache(request).then(cached => {
      const networkFetch = fetch(request).then(response => {
        if (response && response.status === 200 && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });

      if (cached) {
        event.waitUntil(networkFetch.catch(() => undefined));
        return cached;
      }
      return networkFetch;
    })
  );
});
