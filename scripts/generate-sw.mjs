import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";

const dist = resolve("dist");
const walk = async (directory) =>
  (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map(async (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? walk(path) : [path];
      }),
    )
  ).flat();
const files = (await walk(dist))
  .filter((file) => {
    const name = relative(dist, file).replaceAll("\\", "/");
    return (
      name !== "sw.js" &&
      !name.endsWith(".map") &&
      !name.startsWith("examples/")
    );
  })
  .sort();
const hash = createHash("sha256");
for (const file of files)
  hash.update(relative(dist, file)).update(await readFile(file));
const version = hash.digest("hex").slice(0, 20);
const urls = files.map(
  (file) => "./" + relative(dist, file).replaceAll("\\", "/"),
);
const source = `/* Generated after Vite build. App files only; note data stays in IndexedDB. */
const PREFIX = 'folio-shell-' + self.registration.scope + '-';
const CACHE = PREFIX + '${version}';
const URLS = ${JSON.stringify(urls)};
const PRECACHE = URLS.map(path => new URL(path, self.registration.scope).href);
const KNOWN = new Set(PRECACHE);
const INDEX = new URL('./index.html', self.registration.scope).href;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE.map(url => new Request(url, { cache: 'reload' })))));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  // Never intercept remote images, authentication URLs, API responses or unknown files.
  if (request.mode === 'navigate') {
    if (url.search || url.pathname !== scope.pathname && url.pathname !== new URL(INDEX).pathname) return;
    // Keep this worker's HTML paired with this worker's hashed app assets.
    // A waiting version becomes visible only after the user requests activation.
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(INDEX, { ignoreVary: true })) || fetch(request)));
    return;
  }
  if (url.search || !KNOWN.has(url.href)) return;
  // Vite and some static hosts send Vary: Origin. Precache and module requests
  // can carry different Origin headers; exact versioned app URLs are invariant.
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(request, { ignoreVary: true })) || fetch(request)));
});
`;
await writeFile(join(dist, "sw.js"), source);
console.log(`Service worker: ${urls.length} app assets, ${version}`);
