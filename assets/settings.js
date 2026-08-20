(() => {
  const MEDIA_CACHE = 'nce2-media-v1';
  const CONTENT_CACHE = 'nce2-content-v1';
  const DOWNLOAD_CONCURRENCY = 4;
  const DOWNLOAD_RETRIES = 3;
  const DOWNLOAD_TIMEOUT_MS = 45000;
  const PRELOAD_HEADER = 'X-NCE2-Preload';

  let isPreloading = false;
  let wakeLock = null;

  function $(id) {
    return document.getElementById(id);
  }

  async function lessonResources() {
    const res = await fetch('data/lessons.json');
    if (!res.ok) throw new Error(`课程列表请求失败（${res.status}）`);
    const lessons = await res.json();
    return lessons.map((lesson) => ({
      audio: canonicalUrl(`NCE2/${lesson.filename}.mp3`),
      lrc: canonicalUrl(`NCE2/${lesson.filename}.lrc`),
      notes: canonicalUrl(`notes/lesson-${String(lesson.id).padStart(2, '0')}.html`),
    }));
  }

  async function audioUrls() {
    return (await lessonResources()).map((lesson) => lesson.audio);
  }

  function canonicalUrl(url) {
    const resolved = new URL(url, document.baseURI);
    resolved.hash = '';
    resolved.search = '';
    return resolved.href;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
    const digits = bytes >= 100 * 1024 * 1024 ? 0 : 1;
    return `${(bytes / 1024 / 1024).toFixed(digits)} MB`;
  }

  async function cachedAudioUrls(urls) {
    const cache = await caches.open(MEDIA_CACHE);
    const keys = await cache.keys();
    const cached = new Set(keys.map((request) => canonicalUrl(request.url)));
    return urls.filter((url) => cached.has(canonicalUrl(url)));
  }

  async function updateStorageStatus() {
    const el = $('storageStatus');
    if (!el || !navigator.storage?.estimate) return;

    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      const available = Math.max(0, quota - usage);
      el.textContent = `本站已用 ${formatBytes(usage)}，预计可用 ${formatBytes(available)}。`;
    } catch (_) {
      el.textContent = '';
    }
  }

  async function updateCacheStatus(knownUrls) {
    const el = $('cacheStatus');
    try {
      const urls = knownUrls || (await audioUrls());
      const cached = (await cachedAudioUrls(urls)).length;
      const remaining = urls.length - cached;
      el.textContent = `已缓存 ${cached} / ${urls.length} 课音频`;
      $('preloadAll').textContent = remaining === urls.length
        ? '预下载全部音频'
        : remaining > 0
          ? `继续下载剩余 ${remaining} 课`
          : '音频已全部下载';
      $('preloadAll').disabled = isPreloading || remaining === 0;
      await updateStorageStatus();
      return { cached, total: urls.length, remaining };
    } catch (err) {
      el.textContent = '无法读取缓存状态：' + err.message;
      return null;
    }
  }

  async function requestPersistentStorage() {
    if (!navigator.storage?.persisted || !navigator.storage?.persist) return;
    try {
      if (!(await navigator.storage.persisted())) await navigator.storage.persist();
    } catch (_) {
      // Persistence is a best-effort hint. Downloading still works when denied.
    }
  }

  async function requestWakeLock() {
    if (!isPreloading || document.visibilityState !== 'visible' || !navigator.wakeLock?.request) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      }, { once: true });
    } catch (_) {
      // The download remains resumable if the browser refuses a wake lock.
    }
  }

  async function releaseWakeLock() {
    const lock = wakeLock;
    wakeLock = null;
    if (!lock) return;
    try {
      await lock.release();
    } catch (_) {
      // It may already have been released when the page became hidden.
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function downloadResource(cache, url) {
    let lastError;
    for (let attempt = 1; attempt <= DOWNLOAD_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          cache: 'no-store',
          headers: { [PRELOAD_HEADER]: '1' },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`服务器返回 ${res.status}`);
        await cache.put(url, res);
        if (!(await cache.match(url))) throw new Error('缓存写入后无法读取');
        return;
      } catch (err) {
        lastError = err;
      } finally {
        clearTimeout(timeout);
      }
      if (attempt < DOWNLOAD_RETRIES) await sleep(400 * attempt);
    }
    throw lastError;
  }

  function friendlyError(err) {
    if (err?.name === 'QuotaExceededError') return 'iPad 可用存储空间不足';
    if (err?.name === 'AbortError') return '请求超时';
    return err?.message || '未知错误';
  }

  async function preloadAll() {
    if (isPreloading) return;

    const btn = $('preloadAll');
    const progressEl = $('preloadProgress');
    const progressBar = $('preloadBar');
    isPreloading = true;
    btn.disabled = true;

    try {
      const lessons = await lessonResources();
      const urls = lessons.map((lesson) => lesson.audio);
      const cache = await caches.open(MEDIA_CACHE);
      const contentCache = await caches.open(CONTENT_CACHE);
      const alreadyCached = new Set(await cachedAudioUrls(urls));
      const pending = lessons.filter((lesson) => !alreadyCached.has(lesson.audio));

      if (pending.length === 0) {
        progressEl.textContent = '全部音频已缓存到本机。';
        return;
      }

      await requestPersistentStorage();
      await requestWakeLock();

      let next = 0;
      let processed = 0;
      let downloaded = 0;
      const failures = [];

      progressBar.hidden = false;
      progressBar.max = urls.length;
      progressBar.value = alreadyCached.size;

      const renderProgress = () => {
        const cached = alreadyCached.size + downloaded;
        progressBar.value = alreadyCached.size + processed;
        progressEl.textContent = `正在下载：已缓存 ${cached} / ${urls.length}` +
          (failures.length ? `，失败 ${failures.length} 课（稍后可继续）` : '');
        $('cacheStatus').textContent = `已缓存 ${cached} / ${urls.length} 课音频`;
      };

      renderProgress();

      async function worker() {
        while (next < pending.length) {
          const lesson = pending[next++];
          try {
            await downloadResource(cache, lesson.audio);
            downloaded++;
            const supportingDownloads = [lesson.lrc, lesson.notes].map(async (url) => {
              if (!(await caches.match(url, { ignoreSearch: true }))) {
                await downloadResource(contentCache, url);
              }
            });
            const supportingResults = await Promise.allSettled(supportingDownloads);
            supportingResults.forEach((result) => {
              if (result.status === 'rejected') console.warn('Supporting offline content failed:', result.reason);
            });
          } catch (err) {
            failures.push({ url: lesson.audio, error: friendlyError(err) });
            console.warn('Audio preload failed:', lesson.audio, err);
          } finally {
            processed++;
            renderProgress();
          }
        }
      }

      const workerCount = Math.min(DOWNLOAD_CONCURRENCY, pending.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      const finalStatus = await updateCacheStatus(urls);
      if (finalStatus?.remaining === 0) {
        progressBar.value = urls.length;
        progressEl.textContent = '全部音频已缓存到本机，可以离线使用。';
      } else {
        const remaining = finalStatus?.remaining ?? failures.length;
        progressEl.textContent = `本次完成后仍有 ${remaining} 课未缓存。请保持联网并点击“继续下载”重试。`;
      }
    } catch (err) {
      progressEl.textContent = '下载未完成：' + friendlyError(err) + '。已完成的课程会保留，可稍后继续。';
    } finally {
      isPreloading = false;
      await releaseWakeLock();
      await updateCacheStatus();
    }
  }

  function collectLocalData() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith('nce_') || key.startsWith('nce2_')) {
        out[key] = localStorage.getItem(key);
      }
    }
    return out;
  }

  function exportData() {
    const data = { app: 'nce2-ipad', exportedAt: new Date().toISOString(), storage: collectLocalData() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nce2-learning-data.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const storage = data.storage || {};
        Object.entries(storage).forEach(([key, value]) => localStorage.setItem(key, value));
        alert('导入完成');
      } catch (err) {
        alert('导入失败：' + err.message);
      }
    };
    reader.readAsText(file);
  }

  function clearData() {
    if (!confirm('确定要清除本机学习记录吗？此操作不可撤销。')) return;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith('nce_') || key.startsWith('nce2_')) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
    alert('已清除学习记录');
  }

  document.addEventListener('DOMContentLoaded', async () => {
    $('preloadAll').addEventListener('click', preloadAll);
    $('exportData').addEventListener('click', exportData);
    $('clearData').addEventListener('click', clearData);
    $('importFile').addEventListener('change', (e) => {
      if (e.target.files[0]) importData(e.target.files[0]);
    });
    await updateCacheStatus();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isPreloading && !wakeLock) requestWakeLock();
  });
})();
