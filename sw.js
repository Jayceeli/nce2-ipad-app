const CORE_CACHE = 'nce2-core-v7';
const LEGACY_CORE_CACHES = ['nce2-core-v4', 'nce2-core-v5', 'nce2-core-v6'];
const MEDIA_CACHE = 'nce2-media-v1';
const CONTENT_CACHE = 'nce2-content-v1';
const PRELOAD_HEADER = 'X-NCE2-Preload';
const CORE_CACHE_CONCURRENCY = 6;
const CORE_FETCH_TIMEOUT_MS = 12000;

// Keep installation small and reliable. Lesson audio, transcripts, and notes
// are cached by the resumable downloader or on first use.
const APP_SHELL = [
  './',
  'index.html',
  'lesson.html',
  'settings.html',
  'about.html',
  'manifest.webmanifest',
  'favicon.ico',
  'assets/app.js',
  'assets/bootstrap.min.css',
  'assets/common.js',
  'assets/dictation.js',
  'assets/extra.css',
  'assets/favorites.js',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/lesson.js',
  'assets/notes.js',
  'assets/progress.js',
  'assets/register-sw-v7.js',
  'assets/settings.js',
  'assets/styles.css',
  'assets/ui.js',
  'data/lessons.json',
  'data/words.json',
  'static/data.json',
  'notes/img/lesson-07-img-1.png',
  'notes/img/lesson-08-img-1.png',
  'notes/img/lesson-10-img-1.png',
  'notes/img/lesson-27-img-1.png',
  'notes/img/lesson-31-img-1.png',
  'notes/img/lesson-33-img-1.png',
  'notes/img/lesson-72-img-1.png',
  'notes/img/lesson-73-img-1.png',
  'notes/img/lesson-91-img-1.png',
  'notes/img/lesson-92-img-1.png',
];

const REQUIRED_APP_SHELL = [
  './',
  'index.html',
  'settings.html',
  'assets/register-sw-v7.js',
  'assets/settings.js',
  'assets/styles.css',
  'assets/extra.css',
  'data/lessons.json',
];

async function fetchAndCacheCoreAsset(cache, path) {
  const url = new URL(path, self.registration.scope).href;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CORE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: 'reload',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await cache.put(url, response);
  } finally {
    clearTimeout(timeout);
  }
}

async function cacheCoreAssets(cache, paths, required) {
  const failures = [];
  let nextIndex = 0;
  const workerCount = Math.min(CORE_CACHE_CONCURRENCY, paths.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < paths.length) {
        const path = paths[nextIndex];
        nextIndex += 1;
        try {
          await fetchAndCacheCoreAsset(cache, path);
        } catch (err) {
          failures.push({ path, err });
          console.warn('Unable to precache app shell asset:', path, err);
        }
      }
    })
  );

  if (required && failures.length) {
    throw new Error(
      `Required app shell assets failed: ${failures.map(({ path }) => path).join(', ')}`
    );
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CORE_CACHE);
      const required = new Set(REQUIRED_APP_SHELL);
      const optional = APP_SHELL.filter((path) => !required.has(path));

      // Cache each resource separately so one slow optional asset cannot keep
      // iPadOS stuck in the service-worker installing state indefinitely.
      await cacheCoreAssets(cache, REQUIRED_APP_SHELL, true);
      await cacheCoreAssets(cache, optional, false);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then(async (keys) => {
        // Preserve already-downloaded transcripts and notes when upgrading
        // from the previous all-in-one core cache.
        for (const legacyCacheName of LEGACY_CORE_CACHES) {
          if (keys.includes(legacyCacheName)) {
            const legacy = await caches.open(legacyCacheName);
            const content = await caches.open(CONTENT_CACHE);
            const requests = await legacy.keys();
            for (const request of requests) {
              const pathname = new URL(request.url).pathname;
              const isLessonContent = pathname.endsWith('.lrc') || /\/notes\/lesson-\d+\.html$/.test(pathname);
              if (!isLessonContent || (await content.match(request))) continue;
              const response = await legacy.match(request);
              if (response) await content.put(request, response);
            }
          }
        }

        await Promise.all(
          keys
            .filter((key) => key !== CORE_CACHE && key !== MEDIA_CACHE && key !== CONTENT_CACHE)
            .map((key) => caches.delete(key))
        );
      })
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
      try {
        await cache.put(request.url, full.clone());
      } catch (err) {
        // Cache failures must not break online playback.
        console.warn('Unable to cache audio:', request.url, err);
      }
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

  // The settings page owns pre-download writes so progress, retries, and
  // failures are observable. Let these requests go straight to the network.
  if (request.headers.get(PRELOAD_HEADER) === '1') return;

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
