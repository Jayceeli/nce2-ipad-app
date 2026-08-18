const CORE_CACHE = 'nce2-core-v1';
const MEDIA_CACHE = 'nce2-media-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CORE_CACHE)
      .then(async (cache) => {
        const res = await fetch('precache.json');
        const urls = await res.json();
        await cache.addAll(urls);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CORE_CACHE && key !== MEDIA_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function parseRange(res, rangeHeader) {
  return res.blob().then((blob) => {
    const size = blob.size;
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader || '');
    let start = 0;
    let end = size - 1;
    if (match) {
      if (match[1]) start = parseInt(match[1], 10);
      if (match[2]) end = parseInt(match[2], 10);
    }
    if (start >= size) {
      return new Response('', {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      });
    }
    end = Math.min(end, size - 1);
    const sliced = blob.slice(start, end + 1);
    return new Response(sliced, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(sliced.size),
        'Content-Type': blob.type || 'audio/mpeg',
      },
    });
  });
}

async function handleMedia(request) {
  const cache = await caches.open(MEDIA_CACHE);
  const rangeHeader = request.headers.get('range');
  let cached = await cache.match(request.url, { ignoreSearch: true });

  if (!cached) {
    // Fetch without the Range header so we can cache the full file.
    const full = await fetch(request.url);
    if (full.ok) {
      await cache.put(request.url, full.clone());
      cached = full;
    } else {
      return full;
    }
  }

  if (rangeHeader) return parseRange(cached, rangeHeader);
  return cached;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.endsWith('.mp3')) {
    event.respondWith(handleMedia(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CORE_CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() =>
          caches.match(request).then((r) => r || caches.match('index.html'))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CORE_CACHE).then((c) => c.put(request, copy));
        }
        return res;
      });
    })
  );
});
