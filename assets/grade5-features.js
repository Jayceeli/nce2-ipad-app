(() => {
  const DATA_BASE = 'https://raw.githubusercontent.com/Jayceeli/hujiao-grade5-english/main/';
  const AUDIO_URL = 'https://jayceeli.github.io/hujiao-grade5-english/assets/audio-sprite.ogg';
  const CONTENT_CACHE = 'nce2-grade5-content-v1';
  const MEDIA_CACHE = 'nce2-media-v1';
  const nativeFetch = window.fetch.bind(window);

  function isGrade5Remote(url) {
    try {
      const u = new URL(url, location.href);
      return (u.hostname === 'raw.githubusercontent.com' && u.pathname.startsWith('/Jayceeli/hujiao-grade5-english/')) ||
        (u.hostname === 'jayceeli.github.io' && u.pathname.startsWith('/hujiao-grade5-english/'));
    } catch (_) {
      return false;
    }
  }

  // Grade 5 data lives in the companion repository. Fall back to the browser
  // Cache API when the network is unavailable so downloaded units still open.
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (!url || !isGrade5Remote(url)) return nativeFetch(input, init);
    try {
      return await nativeFetch(input, init);
    } catch (err) {
      const isAudio = /\.(?:ogg|mp3)(?:$|\?)/i.test(url);
      const cache = await caches.open(isAudio ? MEDIA_CACHE : CONTENT_CACHE);
      const cached = await cache.match(url, { ignoreSearch: true });
      if (cached) return cached;
      throw err;
    }
  };

  let unit = null;
  let catalog = null;
  let pointData = null;
  let words = [];
  let dictQueue = [];
  let dictIndex = 0;
  let dictStage = 0;
  let cachedAudioObjectUrl = null;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

  async function getJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }

  async function useCachedAudioIfAvailable() {
    const player = $('player');
    if (!player || !('caches' in window)) return;
    try {
      const cache = await caches.open(MEDIA_CACHE);
      const cached = await cache.match(AUDIO_URL, { ignoreSearch: true });
      if (!cached) return;
      const blob = await cached.blob();
      if (!blob.size) return;
      if (cachedAudioObjectUrl) URL.revokeObjectURL(cachedAudioObjectUrl);
      cachedAudioObjectUrl = URL.createObjectURL(blob);
      player.src = cachedAudioObjectUrl;
      player.load();
      const status = $('audioStatus');
      if (status) status.textContent = navigator.onLine ? '已使用本机缓存的出版社原版音频' : '离线模式 · 正在使用已下载的出版社原版音频';
    } catch (_) {}
  }

  function currentUnitId() {
    return decodeURIComponent(location.hash.slice(1) || 'starter');
  }

  function setupTabs() {
    const tabs = document.querySelectorAll('#grade5ViewTabs [data-view]');
    const views = ['point', 'notes', 'dictation', 'offline'];
    tabs.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.view;
        tabs.forEach((b) => b.classList.toggle('active', b === btn));
        views.forEach((name) => {
          const el = $(`view-${name}`);
          if (el) el.hidden = name !== target;
        });
      });
    });
  }

  function suppressUnreviewedText() {
    const root = $('grade5Content');
    if (!root) return;
    root.querySelectorAll('.grade5-static, .grade5-unmapped').forEach((el) => el.remove());
    root.querySelectorAll(':scope > .grade5-note').forEach((el) => el.remove());
  }

  function observePointContent() {
    const root = $('grade5Content');
    if (!root) return;
    suppressUnreviewedText();
    const observer = new MutationObserver(() => suppressUnreviewedText());
    observer.observe(root, { childList: true, subtree: true });
  }

  function parseWords(unitData) {
    const section = (unitData.sections || []).find((s) => s.id === 'words-to-use' || /words to use/i.test(s.title || ''));
    if (!section?.text) return [];
    return String(section.text).split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const m = line.match(/^(.+?)\s+(n\.|v\.|adj\.|adv\.|prep\.|pron\.|conj\.|num\.|phr\.)\s*(.+)$/i);
      if (m) return { word: m[1].trim(), pos: m[2], meaning: m[3].trim(), key: true };
      const zh = line.search(/[\u4e00-\u9fff]/);
      if (zh > 0) return { word: line.slice(0, zh).trim(), pos: '', meaning: line.slice(zh).trim(), key: true };
      return { word: line, pos: '', meaning: '', key: true };
    }).filter((x) => x.word && /[A-Za-z]/.test(x.word));
  }

  function preciseSections() {
    const tracks = pointData?.tracks || {};
    return (unit?.sections || []).map((section) => ({ section, row: tracks[section.track] })).filter((x) => x.row?.segments?.length);
  }

  function renderNotes() {
    const root = $('grade5NotesContent');
    if (!root || !unit) return;
    const precise = preciseSections();
    const key = `nce2_grade5_note_${unit.id}`;
    const stored = localStorage.getItem(key) || '';
    root.innerHTML = `
      <div class="notes-content grade5-notes-panel">
        <h2>${esc(unit.title)}</h2>
        <p class="muted">教材 PDF 第 ${unit.pageRange?.[0] ?? '—'}–${unit.pageRange?.[1] ?? '—'} 页。这里只整理已进入精校时间轴的正文与本单元词汇。</p>
        <h3>精校正文</h3>
        ${precise.length ? precise.map(({section, row}) => `
          <section class="grade5-note-block">
            <h4>${esc(section.title)} <small>· 第 ${(section.pages || []).join(', ')} 页</small></h4>
            <ol>${row.segments.map((seg) => `<li>${esc(seg.text)}</li>`).join('')}</ol>
          </section>`).join('') : '<p class="muted">本单元暂没有已精校逐句正文。</p>'}
        <h3>Words to use</h3>
        ${words.length ? `<div class="grade5-vocab-list">${words.map((w) => `<div class="grade5-vocab-row"><strong>${esc(w.word)}</strong><span>${esc([w.pos, w.meaning].filter(Boolean).join(' · '))}</span></div>`).join('')}</div>` : '<p class="muted">本单元暂未整理 Words to use。</p>'}
        <h3>我的笔记</h3>
        <textarea id="grade5PersonalNote" class="grade5-note-editor" rows="8" placeholder="记录老师补充、易错点、句型或自己的复习笔记…">${esc(stored)}</textarea>
        <p id="grade5NoteSaved" class="muted"></p>
      </div>`;
    const editor = $('grade5PersonalNote');
    let timer = null;
    editor?.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        localStorage.setItem(key, editor.value);
        $('grade5NoteSaved').textContent = '已自动保存到本机';
      }, 250);
    });
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.85;
    const voice = speechSynthesis.getVoices().find((v) => /^en/i.test(v.lang || ''));
    if (voice) u.voice = voice;
    speechSynthesis.speak(u);
  }

  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function renderDictCard() {
    const item = dictQueue[dictIndex];
    if (!item) return;
    $('grade5DictProgress').textContent = `第 ${dictIndex + 1} / ${dictQueue.length} 个单词`;
    $('grade5DictWord').textContent = '点击卡片听发音';
    $('grade5DictMeaning').textContent = '';
    dictStage = 0;
  }

  function finishDictation() {
    $('grade5DictCard').hidden = true;
    $('grade5DictResult').hidden = false;
    $('grade5DictResult').innerHTML = `<h3>本轮完成</h3><div class="grade5-vocab-list">${dictQueue.map((w) => `<div class="grade5-vocab-row"><strong>${esc(w.word)}</strong><span>${esc([w.pos, w.meaning].filter(Boolean).join(' · '))}</span></div>`).join('')}</div>`;
    localStorage.setItem(`nce2_grade5_dict_${unit.id}`, JSON.stringify({ count: dictQueue.length, at: Date.now() }));
  }

  function startDictation() {
    if (!words.length) {
      $('grade5DictStatus').textContent = '本单元暂没有可用于听写的 Words to use。';
      return;
    }
    dictQueue = shuffle(words);
    dictIndex = 0;
    $('grade5DictCard').hidden = false;
    $('grade5DictResult').hidden = true;
    renderDictCard();
  }

  function setupDictation() {
    $('grade5DictStatus').textContent = `本单元可听写 ${words.length} 个词/短语`;
    $('grade5DictStart').addEventListener('click', startDictation);
    $('grade5DictCard').addEventListener('click', () => {
      const item = dictQueue[dictIndex];
      if (!item) return;
      if (dictStage === 0) {
        speak(item.word);
        $('grade5DictWord').textContent = '再点一下显示答案';
        dictStage = 1;
      } else if (dictStage === 1) {
        $('grade5DictWord').textContent = item.word;
        $('grade5DictMeaning').textContent = [item.pos, item.meaning].filter(Boolean).join(' · ');
        dictStage = 2;
      } else {
        dictIndex += 1;
        if (dictIndex >= dictQueue.length) finishDictation();
        else renderDictCard();
      }
    });
  }

  async function grade5Resources() {
    const cat = catalog || await getJSON(DATA_BASE + 'data/index.json');
    const pointIndex = await getJSON(DATA_BASE + 'data/point-v3/index.json');
    const urls = [DATA_BASE + 'data/index.json', DATA_BASE + 'data/audio-sprite-manifest.json', DATA_BASE + 'data/point-v3/index.json', AUDIO_URL];
    (cat.units || []).forEach((item) => urls.push(DATA_BASE + 'data/' + item.file));
    (pointIndex.files || []).forEach((file) => urls.push(DATA_BASE + 'data/' + file));
    return [...new Set(urls)];
  }

  async function offlineStatus(resources = null) {
    const urls = resources || await grade5Resources();
    const content = await caches.open(CONTENT_CACHE);
    const media = await caches.open(MEDIA_CACHE);
    let count = 0;
    for (const url of urls) {
      const cache = url === AUDIO_URL ? media : content;
      if (await cache.match(url)) count += 1;
    }
    $('grade5OfflineStatus').textContent = `已缓存 ${count} / ${urls.length} 个五上离线资源`;
    return { count, total: urls.length };
  }

  async function downloadAll() {
    const btn = $('grade5OfflineDownload');
    const progress = $('grade5OfflineProgress');
    btn.disabled = true;
    try {
      const urls = await grade5Resources();
      const content = await caches.open(CONTENT_CACHE);
      const media = await caches.open(MEDIA_CACHE);
      let done = 0;
      progress.max = urls.length;
      progress.value = 0;
      progress.hidden = false;
      if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
      for (const url of urls) {
        const cache = url === AUDIO_URL ? media : content;
        if (!(await cache.match(url))) {
          const res = await nativeFetch(url, { cache: 'no-store' });
          if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
          await cache.put(url, res.clone());
        }
        done += 1;
        progress.value = done;
        $('grade5OfflineStatus').textContent = `正在缓存 ${done} / ${urls.length}`;
      }
      await useCachedAudioIfAvailable();
      $('grade5OfflineStatus').textContent = '五年级上全部教材数据与原版音频已缓存，可离线使用。';
    } catch (err) {
      $('grade5OfflineStatus').textContent = `离线下载未完成：${err.message}。已成功缓存的内容会保留，可再次点击继续。`;
    } finally {
      btn.disabled = false;
    }
  }

  async function loadFeatureData() {
    const unitId = currentUnitId();
    catalog = await getJSON(DATA_BASE + 'data/index.json');
    const info = (catalog.units || []).find((x) => x.id === unitId) || catalog.units?.[0];
    if (!info) throw new Error('找不到当前单元');
    unit = await getJSON(DATA_BASE + 'data/' + info.file);
    const pointIndex = await getJSON(DATA_BASE + 'data/point-v3/index.json');
    const pointFile = (pointIndex.files || []).find((f) => f.endsWith('/' + info.file));
    pointData = pointFile ? await getJSON(DATA_BASE + 'data/' + pointFile) : { tracks: {} };
    words = parseWords(unit);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    setupTabs();
    observePointContent();
    await useCachedAudioIfAvailable();
    try {
      await loadFeatureData();
      renderNotes();
      setupDictation();
      $('grade5OfflineDownload').addEventListener('click', downloadAll);
      offlineStatus().catch(() => {});
    } catch (err) {
      if ($('grade5NotesContent')) $('grade5NotesContent').innerHTML = `<p class="grade5-note">五上扩展功能加载失败：${esc(err.message)}</p>`;
      if ($('grade5DictStatus')) $('grade5DictStatus').textContent = '单词听写数据加载失败';
      if ($('grade5OfflineStatus')) $('grade5OfflineStatus').textContent = '离线资源列表加载失败';
    }
  });

  window.addEventListener('pagehide', () => {
    if (cachedAudioObjectUrl) URL.revokeObjectURL(cachedAudioObjectUrl);
  });
})();
