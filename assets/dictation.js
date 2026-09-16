(() => {
  let initialized = false;
  let context = null;
  let allWords = [];
  let queue = [];
  let current = 0;
  let stage = 0;
  let started = false;
  let wordsMeta = {};
  let wordAudio = null;
  let wordTimer = 0;

  const $ = (id) => document.getElementById(id);

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function setHint(text) {
    const el = $('dictStageHint');
    if (el) el.textContent = text;
  }

  function stopWordAudio() {
    if (wordTimer) cancelAnimationFrame(wordTimer);
    wordTimer = 0;
    if (wordAudio) wordAudio.pause();
  }

  function playOriginalSegment(spec) {
    if (!spec?.url || !Number.isFinite(spec.start) || !Number.isFinite(spec.end)) return false;
    stopWordAudio();
    wordAudio = wordAudio || new Audio();
    wordAudio.src = spec.url;
    wordAudio.preload = 'auto';
    const offset = Number(spec.offset || 0);
    const start = offset + Number(spec.start);
    const end = offset + Number(spec.end);
    const go = () => {
      try { wordAudio.currentTime = start; } catch (_) {}
      wordAudio.play().catch(() => {});
      const tick = () => {
        wordTimer = requestAnimationFrame(tick);
        if (!wordAudio.paused && wordAudio.currentTime >= end - 0.018) {
          wordAudio.pause();
          cancelAnimationFrame(wordTimer); wordTimer = 0;
        }
      };
      wordTimer = requestAnimationFrame(tick);
    };
    if (wordAudio.readyState >= 1) go();
    else wordAudio.addEventListener('loadedmetadata', go, { once:true });
    return true;
  }

  function speakTts(word) {
    if (!('speechSynthesis' in window)) return false;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US'; u.rate = 0.85;
    const voices = window.speechSynthesis.getVoices();
    const en = voices.find((v) => v.lang?.toLowerCase().startsWith('en'));
    if (en) u.voice = en;
    window.speechSynthesis.speak(u);
    return true;
  }

  function pronounce(item) {
    if (item.audio && playOriginalSegment(item.audio)) {
      setHint('正在播放教材原版单词音频；再点一下显示单词');
      return true;
    }
    if (wordsMeta.originalAudioTrack && wordsMeta.wordAudioStatus !== 'missing') {
      setHint('本教材存在原版单词音频，但该词逐词时间边界尚未可靠确认；为避免错读，暂不使用 TTS 替代。');
      return false;
    }
    const ok = speakTts(item.word);
    setHint(ok ? '正在使用系统发音；再点一下显示单词' : '当前设备无法播放单词发音；再点一下显示单词');
    return ok;
  }

  function renderCard() {
    const item = queue[current];
    $('dictProgress').textContent = `第 ${current + 1} / ${queue.length} 个单词`;
    setHint(item?.audio ? '点击卡片，播放教材原版发音' : '点击卡片，先听发音');
    $('dictFront').hidden = false;
    $('dictBack').hidden = true;
    $('dictCard').classList.remove('revealed', 'listening');
    stage = 0;
  }

  function revealCard() {
    const item = queue[current];
    $('dictBack').innerHTML = `
      <div class="dict-flash-word">${item.word}</div>
      <div class="dict-flash-meta">/${item.phonetic || '—'}/ · ${item.pos || ''} · ${item.meaning || ''}</div>`;
    $('dictFront').hidden = true; $('dictBack').hidden = false;
    setHint('再点一下，看下一个单词');
    $('dictCard').classList.add('revealed'); stage = 2;
  }

  function finish() {
    const { book, lesson } = context;
    const key = `learning_flash_${book.id}_${lesson.wordsKey || lesson.id}`;
    const prev = JSON.parse(localStorage.getItem(key) || '{}');
    localStorage.setItem(key, JSON.stringify({ lastCount:queue.length, lastAt:Date.now(), best:Math.max(prev.best || 0, queue.length) }));
    $('dictSummary').innerHTML = queue.map((item) => `
      <div class="dict-summary-item"><div class="dict-summary-word">${item.word}</div>
      <div class="dict-summary-meta">/${item.phonetic || '—'}/ · ${item.pos || ''} · ${item.meaning || ''}</div></div>`).join('');
    $('dictQuiz').hidden = true; $('dictResult').hidden = false; started = false;
  }

  function start(scope) {
    const pool = scope === 'key' ? allWords.filter((w) => w.key) : allWords;
    if (!pool.length) { alert('本内容没有可练习的单词'); return; }
    queue = shuffle(pool); current = 0; started = true;
    $('dictQuiz').hidden = false; $('dictResult').hidden = true; renderCard();
  }

  async function init() {
    if (initialized) return;
    initialized = true;
    try {
      context = await window.NCE_COMMON.getCurrentContext();
      const { book, lesson } = context;
      const source = lesson.wordsSource || book.words;
      if (!source) throw new Error('未配置单词数据');
      const data = await window.NCE_COMMON.fetchJson(source);
      wordsMeta = data.meta || {};
      const key = lesson.wordsKey || String(lesson.order || lesson.id);
      allWords = Array.isArray(data) ? data : (data[key] || []);
      const keyCount = allWords.filter((w) => w.key).length;
      let suffix = '';
      if (wordsMeta.originalAudioTrack && wordsMeta.wordAudioStatus === 'alignment-pending') suffix = ' · 原版逐词音频待精确对齐';
      $('dictWordCount').textContent = `本内容词汇 ${allWords.length} 个，其中重点词 ${keyCount} 个${suffix}`;
    } catch (err) {
      $('dictWordCount').textContent = '单词加载失败：' + err.message;
    }

    if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
    $('dictStart')?.addEventListener('click', () => start($('dictScope').value));
    $('dictRestart')?.addEventListener('click', () => start($('dictScope').value));
    $('dictCard')?.addEventListener('click', () => {
      if (!started || !queue[current]) return;
      if (stage === 0) {
        pronounce(queue[current]);
        $('dictCard').classList.add('listening');
        stage = 1;
      } else if (stage === 1) revealCard();
      else { current++; current < queue.length ? renderCard() : finish(); }
    });
  }

  window.NCE_DICTATION = { init };
})();
