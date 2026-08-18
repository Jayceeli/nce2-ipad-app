(() => {
  const MEDIA_CACHE = 'nce2-media-v1';

  function $(id) {
    return document.getElementById(id);
  }

  async function audioUrls() {
    const res = await fetch('data/lessons.json');
    const lessons = await res.json();
    return lessons.map((l) => `NCE2/${l.filename}.mp3`);
  }

  async function cachedCount() {
    const cache = await caches.open(MEDIA_CACHE);
    const keys = await cache.keys();
    return keys.length;
  }

  async function updateCacheStatus() {
    const el = $('cacheStatus');
    try {
      const total = (await audioUrls()).length;
      const cached = await cachedCount();
      el.textContent = `已缓存 ${cached} / ${total} 课音频`;
    } catch (err) {
      el.textContent = '无法读取缓存状态：' + err.message;
    }
  }

  async function preloadAll() {
    const btn = $('preloadAll');
    const progressEl = $('preloadProgress');
    btn.disabled = true;
    try {
      const urls = await audioUrls();
      const cache = await caches.open(MEDIA_CACHE);
      let done = 0;
      for (const url of urls) {
        progressEl.textContent = `正在下载 ${done + 1} / ${urls.length}…`;
        const cached = await cache.match(url);
        if (!cached) {
          const res = await fetch(url);
          if (res.ok) await cache.put(url, res);
        }
        done++;
      }
      progressEl.textContent = '全部音频已缓存到本机。';
      await updateCacheStatus();
    } catch (err) {
      progressEl.textContent = '下载失败：' + err.message;
    } finally {
      btn.disabled = false;
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
})();
