(() => {
  const MEDIA_CACHE = 'english-reader-media-v1';
  const CONTENT_CACHE = 'english-reader-content-v1';
  const DOWNLOAD_CONCURRENCY = 4;
  const DOWNLOAD_RETRIES = 3;
  const DOWNLOAD_TIMEOUT_MS = 45000;
  const PRELOAD_HEADER = 'X-English-Preload';
  let isPreloading = false;
  let wakeLock = null;
  let currentBook = null;

  const $ = (id) => document.getElementById(id);
  const canonicalUrl = (url) => { const u = new URL(url, document.baseURI); u.hash=''; u.search=''; return u.href; };
  const isSameOrigin = (url) => new URL(url, document.baseURI).origin === location.origin;

  async function resourcesForBook() {
    const bookId = window.NCE_COMMON.getBookIdFromQuery() || 'nce2';
    currentBook = await window.NCE_COMMON.getBook(bookId);
    const lessons = await window.NCE_COMMON.getLessons(bookId);
    const resources = lessons.map((lesson) => ({
      id: lesson.id,
      audio: lesson.audio ? canonicalUrl(lesson.audio) : null,
      supporting: [lesson.transcript, lesson.timings, lesson.notes].filter(Boolean).map(canonicalUrl),
    }));
    return { book:currentBook, lessons, resources };
  }

  function uniqueAudio(resources) {
    return [...new Set(resources.map((r) => r.audio).filter(Boolean))];
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
    const digits = bytes >= 100 * 1024 * 1024 ? 0 : 1;
    return `${(bytes / 1024 / 1024).toFixed(digits)} MB`;
  }

  async function cachedUrls(urls) {
    const out = [];
    for (const url of urls) if (await caches.match(url, { ignoreSearch:true })) out.push(url);
    return out;
  }

  async function updateStorageStatus() {
    if (!$('storageStatus') || !navigator.storage?.estimate) return;
    try {
      const { usage=0, quota=0 } = await navigator.storage.estimate();
      $('storageStatus').textContent = `本站已用 ${formatBytes(usage)}，预计可用 ${formatBytes(Math.max(0, quota-usage))}。`;
    } catch (_) { $('storageStatus').textContent = ''; }
  }

  async function updateCacheStatus(knownUrls) {
    try {
      const { book, resources } = currentBook ? {book:currentBook, resources:(await resourcesForBook()).resources} : await resourcesForBook();
      const urls = knownUrls || uniqueAudio(resources);
      const cached = (await cachedUrls(urls)).length;
      const remaining = urls.length - cached;
      if ($('settingsBookTitle')) $('settingsBookTitle').textContent = book.shortTitle || book.title;
      if ($('cacheStatus')) $('cacheStatus').textContent = `已缓存 ${cached} / ${urls.length} 个音频文件`;
      if ($('cacheHint')) $('cacheHint').textContent = `当前教材共有 ${resources.length} 个学习内容，实际音频文件 ${urls.length} 个；共享音频不会重复下载。`;
      if ($('preloadAll')) {
        $('preloadAll').textContent = remaining === 0 ? '当前教材音频已全部下载' : cached ? `继续下载剩余 ${remaining} 个音频` : '下载当前教材音频';
        $('preloadAll').disabled = isPreloading || remaining === 0;
      }
      if ($('preloadBar')) $('preloadBar').max = Math.max(1, urls.length);
      await updateStorageStatus();
      return { cached, total:urls.length, remaining, urls };
    } catch (err) {
      if ($('cacheStatus')) $('cacheStatus').textContent = '无法读取缓存状态：' + err.message;
      return null;
    }
  }

  async function requestPersistentStorage() {
    try { if (navigator.storage?.persist && !(await navigator.storage.persisted?.())) await navigator.storage.persist(); } catch (_) {}
  }
  async function requestWakeLock() {
    if (!isPreloading || document.visibilityState !== 'visible' || !navigator.wakeLock?.request) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => wakeLock=null, {once:true}); } catch (_) {}
  }
  async function releaseWakeLock() { try { await wakeLock?.release(); } catch (_) {} wakeLock=null; }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function downloadResource(cache, url) {
    let last;
    for (let attempt=1; attempt<=DOWNLOAD_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
      try {
        const options = { cache:'no-store', signal:controller.signal, headers:{} };
        if (isSameOrigin(url)) options.headers[PRELOAD_HEADER] = '1';
        const res = await fetch(url, options);
        if (!res.ok) throw new Error(`服务器返回 ${res.status}`);
        await cache.put(url, res.clone());
        if (!(await caches.match(url, {ignoreSearch:true}))) throw new Error('缓存写入后无法读取');
        return;
      } catch (err) { last=err; }
      finally { clearTimeout(timer); }
      if (attempt<DOWNLOAD_RETRIES) await sleep(400*attempt);
    }
    throw last;
  }

  function friendlyError(err) {
    if (err?.name === 'QuotaExceededError') return 'iPad 可用存储空间不足';
    if (err?.name === 'AbortError') return '请求超时';
    return err?.message || '未知错误';
  }

  async function preloadAll() {
    if (isPreloading) return;
    isPreloading=true; $('preloadAll').disabled=true;
    const progressEl=$('preloadProgress'), bar=$('preloadBar');
    try {
      const { resources } = await resourcesForBook();
      const urls=uniqueAudio(resources);
      const mediaCache=await caches.open(MEDIA_CACHE), contentCache=await caches.open(CONTENT_CACHE);
      const existing=new Set(await cachedUrls(urls));
      const pending=urls.filter((u)=>!existing.has(u));
      if (!pending.length) { progressEl.textContent='当前教材音频已全部缓存。'; return; }
      await requestPersistentStorage(); await requestWakeLock();
      let next=0, done=0; const failures=[];
      bar.hidden=false; bar.max=Math.max(1,urls.length); bar.value=existing.size;
      const render=()=>{ bar.value=existing.size+done; progressEl.textContent=`正在下载：${existing.size+done} / ${urls.length}`+(failures.length?`，失败 ${failures.length}`:''); };
      render();
      async function worker() {
        while (next<pending.length) {
          const url=pending[next++];
          try {
            await downloadResource(mediaCache,url); done++;
            const supporting=[...new Set(resources.filter((r)=>r.audio===url).flatMap((r)=>r.supporting))];
            for (const s of supporting) if (!(await caches.match(s,{ignoreSearch:true}))) { try { await downloadResource(contentCache,s); } catch (e) { console.warn('supporting cache failed',s,e); } }
          } catch (err) { failures.push({url,error:friendlyError(err)}); }
          render();
        }
      }
      await Promise.all(Array.from({length:Math.min(DOWNLOAD_CONCURRENCY,pending.length)},worker));
      const status=await updateCacheStatus(urls);
      progressEl.textContent=status?.remaining===0?'当前教材音频已全部缓存，可以离线使用。':`仍有 ${status?.remaining ?? failures.length} 个音频未缓存，可稍后继续。`;
    } catch (err) { progressEl.textContent='下载未完成：'+friendlyError(err); }
    finally { isPreloading=false; await releaseWakeLock(); await updateCacheStatus(); }
  }

  function collectLocalData() {
    const out={};
    for (let i=0;i<localStorage.length;i++) {
      const k=localStorage.key(i);
      if (k?.startsWith('learning_') || k?.startsWith('nce_') || k?.startsWith('nce2_')) out[k]=localStorage.getItem(k);
    }
    return out;
  }
  function exportData() {
    const data={app:'english-reader',version:'2.0',exportedAt:new Date().toISOString(),storage:collectLocalData()};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}), a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download='english-reader-learning-data.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  }
  function importData(file) {
    const r=new FileReader(); r.onload=()=>{ try { const data=JSON.parse(r.result); Object.entries(data.storage||{}).forEach(([k,v])=>localStorage.setItem(k,v)); alert('导入完成'); } catch(e){ alert('导入失败：'+e.message); } }; r.readAsText(file);
  }
  function clearData() {
    if (!confirm('确定要清除本机学习记录吗？此操作不可撤销。')) return;
    const keys=[]; for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith('learning_')||k?.startsWith('nce_')||k?.startsWith('nce2_'))keys.push(k);} keys.forEach((k)=>localStorage.removeItem(k)); alert('已清除学习记录');
  }

  document.addEventListener('DOMContentLoaded', async()=>{
    $('preloadAll')?.addEventListener('click',preloadAll);
    $('exportData')?.addEventListener('click',exportData);
    $('clearData')?.addEventListener('click',clearData);
    $('importFile')?.addEventListener('change',(e)=>e.target.files[0]&&importData(e.target.files[0]));
    await updateCacheStatus();
  });
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'&&isPreloading&&!wakeLock)requestWakeLock(); });
})();
