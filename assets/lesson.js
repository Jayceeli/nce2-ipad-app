(() => {
  const LINE_RE = /^((?:\[\d+:\d+(?:\.\d+)?\])+)(.*)$/;
  const META_RE = /^\[(al|ar|ti|by):(.+)\]$/i;

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const hasCJK = (s) => /[\u3400-\u9FFF\uF900-\uFAFF]/.test(s || '');

  function timeTagsToSeconds(tags) {
    const m = /\[(\d+):(\d+(?:\.\d+)?)\]/.exec(tags);
    return m ? parseInt(m[1], 10) * 60 + parseFloat(m[2]) : 0;
  }

  async function fetchText(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Fetch failed ${url} (${r.status})`);
    return r.text();
  }

  async function loadLrc(url) {
    const text = await fetchText(url);
    const rows = text.replace(/\r/g, '').split('\n');
    const meta = { al:'', ar:'', ti:'', by:'' };
    const items = [];
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i].trim();
      if (!raw) continue;
      const mm = raw.match(META_RE);
      if (mm) { meta[mm[1].toLowerCase()] = mm[2].trim(); continue; }
      const m = raw.match(LINE_RE);
      if (!m) continue;
      const tags = m[1];
      const start = timeTagsToSeconds(tags);
      const body = m[2].trim();
      let en = body, cn = '';
      if (body.includes('|')) {
        const p = body.split('|');
        en = (p[0] || '').trim();
        cn = (p.slice(1).join('|') || '').trim();
      } else if (i + 1 < rows.length) {
        const m2 = rows[i + 1].trim().match(LINE_RE);
        if (m2 && m2[1] === tags && hasCJK(m2[2])) {
          cn = m2[2].trim();
          i++;
        }
      }
      if (en) items.push({ start, end: 0, en, cn });
    }
    items.forEach((it, i) => { it.end = i + 1 < items.length ? items[i + 1].start : 0; });
    return { meta, items };
  }

  function normalizeText(s) {
    return String(s || '').toLowerCase().replace(/[“”‘’'".,!?;:—–\-\s]/g, '');
  }

  async function applyExplicitTimings(items, url) {
    if (!url || !items.length) return items;
    const data = await window.NCE_COMMON.fetchJson(url);
    const segs = data.segments || [];
    if (segs.length !== items.length) {
      console.warn('Timing count mismatch', url, segs.length, items.length);
    }
    for (let i = 0; i < Math.min(segs.length, items.length); i++) {
      const s = segs[i];
      if (normalizeText(s.text) !== normalizeText(items[i].en)) {
        console.warn('Timing text mismatch', i, s.text, items[i].en);
      }
      if (Number.isFinite(s.start)) items[i].start = Number(s.start);
      if (Number.isFinite(s.end)) items[i].end = Number(s.end);
      items[i].timingSource = data.method || 'explicit';
    }
    return items;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (!location.hash) { location.href = 'index.html'; return; }

    const titleEl = $('#lessonTitle');
    const subEl = $('#lessonSub');
    const listEl = $('#sentences');
    const audio = $('#player');
    const backLink = $('#backLink');
    const prevLessonLink = $('#prevLesson');
    const nextLessonLink = $('#nextLesson');
    const speedSelect = $('#speedSelect');
    const loopBtn = $('#loopBtn');
    const dictationBtn = $('#dictationBtn');
    const playPauseBtn = $('#playPauseBtn');
    const playIcon = $('#playIcon');
    const pauseIcon = $('#pauseIcon');
    const timeline = $('#timeline');
    const currentTimeEl = $('#currentTime');
    const durationEl = $('#duration');
    const volumeBtn = $('#volumeBtn');
    const volumeIcon = $('#volumeIcon');
    const muteIcon = $('#muteIcon');
    const volumeSlider = $('#volumeSlider');
    const helpBtn = $('#helpBtn');
    const helpTooltip = $('#helpTooltip');

    let context;
    let book;
    let lesson;
    let lessons = [];
    let items = [];
    let activeIdx = -1;
    let pointMode = false;
    let pointEndAbs = null;
    let loopMode = false;
    let dictationMode = false;
    let revealed = new Set();
    let monitorId = 0;
    let sessionStarted = Date.now();
    let played = new Set();
    let isSeeking = false;
    let mediaReady = false;

    try {
      context = await window.NCE_COMMON.getCurrentContext();
      ({ book, lesson, lessons } = context);
    } catch (err) {
      titleEl.textContent = '课程加载失败';
      subEl.textContent = err.message;
      return;
    }

    const audioOffset = Number(lesson.audioOffset || 0);
    const configuredDuration = Number(lesson.audioDuration || 0);
    const lessonEndAbs = () => audioOffset + relativeDuration();
    const relativeTime = () => Math.max(0, audio.currentTime - audioOffset);
    const relativeDuration = () => configuredDuration || Math.max(0, (audio.duration || 0) - audioOffset);

    function formatTime(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${String(secs).padStart(2, '0')}`;
    }

    function validEnd(it, i) {
      if (Number.isFinite(it.end) && it.end > it.start) return it.end;
      if (i + 1 < items.length && Number.isFinite(items[i + 1].start)) return items[i + 1].start;
      return relativeDuration() || (it.start + 3);
    }

    function setAudioPosition(relativeSeconds) {
      const dur = relativeDuration();
      const rel = Math.max(0, Math.min(Number(relativeSeconds) || 0, dur || Number.MAX_SAFE_INTEGER));
      try { audio.currentTime = audioOffset + rel; } catch (_) {}
    }

    function canPoint(it, i) {
      return lesson.pointReading !== false && Number.isFinite(it.start) && validEnd(it, i) > it.start && !!lesson.audio;
    }

    function render() {
      listEl.innerHTML = items.map((it, i) => {
        const pointable = canPoint(it, i);
        const isRevealed = revealed.has(i);
        const hidden = dictationMode && !isRevealed ? 'hidden-text' : '';
        const fav = window.favoritesManager?.isFavorite(book.id, lesson.id, i);
        const cn = it.cn
          ? `<div class="cn">${esc(it.cn)}</div>`
          : (lesson.translationStatus === 'missing' || book.translationStatus === 'missing')
            ? '<div class="cn muted translation-missing">中文翻译：missing（教材未提供）</div>'
            : '';
        return `
          <div class="sentence ${hidden} ${pointable ? 'pointable' : 'static-line'}" data-idx="${i}" tabindex="${pointable ? '0' : '-1'}">
            <button class="favorite-btn ${fav ? 'active' : ''}" data-idx="${i}" title="收藏句子" aria-label="收藏句子">★</button>
            <div class="sentence-content">
              <div class="en">${esc(it.en)}</div>${cn}
            </div>
            ${dictationMode && !isRevealed ? '<div class="reveal-hint">点击显示文本</div>' : ''}
          </div>`;
      }).join('');

      listEl.querySelectorAll('.favorite-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const i = Number(btn.dataset.idx);
          const it = items[i];
          const on = window.favoritesManager?.toggleFavorite(book.id, lesson.id, i, {
            en: it.en, cn: it.cn || '', start: it.start, end: validEnd(it, i),
            unitId: lesson.unitId || '', unitTitle: lesson.unitTitle || '', lessonTitle: lesson.title,
          });
          btn.classList.toggle('active', !!on);
        });
      });

      listEl.querySelectorAll('.sentence').forEach((el) => {
        const i = Number(el.dataset.idx);
        const activate = () => {
          if (dictationMode && !revealed.has(i)) {
            revealed.add(i); render(); highlight(i, false); return;
          }
          if (canPoint(items[i], i)) playPoint(i);
        };
        el.addEventListener('click', (e) => { if (!e.target.closest('.favorite-btn')) activate(); });
        el.addEventListener('keydown', (e) => {
          if ((e.key === 'Enter' || e.key === ' ') && canPoint(items[i], i)) { e.preventDefault(); activate(); }
        });
      });
      if (activeIdx >= 0) highlight(activeIdx, false);
    }

    function highlight(i, smooth = true) {
      if (i < 0 || i >= items.length) return;
      listEl.querySelector('.sentence.active')?.classList.remove('active');
      const cur = listEl.querySelector(`.sentence[data-idx="${i}"]`);
      cur?.classList.add('active');
      activeIdx = i;
      if (smooth) cur?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function findCurrentIndex(t) {
      if (!items.length) return -1;
      for (let i = 0; i < items.length; i++) {
        if (!Number.isFinite(items[i].start)) continue;
        const end = validEnd(items[i], i);
        if (t >= items[i].start && t < end) return i;
      }
      let prev = -1;
      for (let i = 0; i < items.length; i++) {
        if (Number.isFinite(items[i].start) && items[i].start <= t) prev = i;
      }
      return prev;
    }

    function clearMonitor() {
      if (monitorId) cancelAnimationFrame(monitorId);
      monitorId = 0;
    }

    function ensureMonitor() {
      if (monitorId) return;
      const tick = () => {
        monitorId = requestAnimationFrame(tick);
        if (audio.paused) return;
        const rel = relativeTime();
        if (pointMode && pointEndAbs != null && audio.currentTime >= pointEndAbs - 0.018) {
          if (loopMode && activeIdx >= 0) {
            setAudioPosition(items[activeIdx].start);
            audio.play().catch(() => {});
          } else {
            audio.pause();
            try { audio.currentTime = pointEndAbs; } catch (_) {}
            pointMode = false;
            pointEndAbs = null;
          }
          return;
        }
        if (!pointMode && configuredDuration && audio.currentTime >= lessonEndAbs() - 0.018) {
          audio.pause();
          setAudioPosition(configuredDuration);
        }
      };
      monitorId = requestAnimationFrame(tick);
    }

    function playPoint(i) {
      const it = items[i];
      if (!it || !canPoint(it, i) || !mediaReady) return;
      activeIdx = i;
      pointMode = true;
      pointEndAbs = audioOffset + validEnd(it, i);
      setAudioPosition(it.start);
      highlight(i);
      played.add(i);
      window.progressManager?.markSentenceLearned(book.id, lesson.id, i, Math.max(0, validEnd(it, i) - it.start));
      audio.playbackRate = Number(speedSelect?.value || 1);
      audio.play().then(ensureMonitor).catch(() => {});
    }

    function playContinuous() {
      if (!lesson.audio || !mediaReady) return;
      pointMode = false;
      pointEndAbs = null;
      const rel = relativeTime();
      if (audio.currentTime < audioOffset || (configuredDuration && rel >= configuredDuration)) setAudioPosition(0);
      audio.playbackRate = Number(speedSelect?.value || 1);
      audio.play().then(ensureMonitor).catch(() => {});
    }

    function updatePlayerUI() {
      const rel = relativeTime();
      const dur = relativeDuration();
      if (!isSeeking && timeline && dur > 0) timeline.value = String((rel / dur) * 100);
      if (currentTimeEl) currentTimeEl.textContent = formatTime(rel);
      if (durationEl) durationEl.textContent = formatTime(dur);
      if (!pointMode) {
        const i = findCurrentIndex(rel);
        if (i >= 0 && i !== activeIdx) highlight(i, false);
      }
    }

    titleEl.textContent = lesson.title;
    const page = lesson.page ? ` · p.${lesson.page}` : '';
    const missing = (lesson.translationStatus === 'missing' || book.translationStatus === 'missing') ? ' · 中文译文 missing' : '';
    subEl.textContent = `${lesson.unitTitle || book.shortTitle || book.title} · ${lesson.section || ''}${page}${missing}`;
    document.title = `${lesson.title} · ${book.shortTitle || book.title}`;

    if (backLink) {
      backLink.href = `index.html?book=${encodeURIComponent(book.id)}`;
      backLink.onclick = (e) => {
        e.preventDefault();
        try {
          if (document.referrer && new URL(document.referrer).origin === location.origin) { history.back(); return; }
        } catch (_) {}
        location.href = backLink.href;
      };
    }

    const currentIndex = lessons.findIndex((l) => l.id === lesson.id);
    if (prevLessonLink) {
      if (currentIndex > 0) prevLessonLink.href = window.NCE_COMMON.buildLessonHref(book.id, lessons[currentIndex - 1]);
      else prevLessonLink.style.display = 'none';
    }
    if (nextLessonLink) {
      if (currentIndex >= 0 && currentIndex + 1 < lessons.length) nextLessonLink.href = window.NCE_COMMON.buildLessonHref(book.id, lessons[currentIndex + 1]);
      else nextLessonLink.style.display = 'none';
    }

    try {
      if (lesson.transcript) {
        const loaded = await loadLrc(lesson.transcript);
        items = await applyExplicitTimings(loaded.items, lesson.timings);
        if (!lesson.title && loaded.meta.ti) titleEl.textContent = loaded.meta.ti;
      } else {
        items = (lesson.content || []).map((en) => ({ en, cn:'', start:null, end:null }));
      }
    } catch (err) {
      console.error(err);
      items = (lesson.content || []).map((en) => ({ en, cn:'', start:null, end:null }));
      subEl.textContent += ' · transcript missing';
    }
    render();

    window.progressManager?.saveLessonProgress(book.id, lesson.id, {
      totalSentences: items.length,
      lastVisit: Date.now(),
      legacyId: lesson.legacyId || null,
    });

    if (lesson.audio) {
      audio.preload = 'metadata';
      audio.src = lesson.audio;
      audio.load();
    } else {
      mediaReady = false;
      if (playPauseBtn) playPauseBtn.disabled = true;
      if (timeline) timeline.disabled = true;
      if (speedSelect) speedSelect.disabled = true;
      if (loopBtn) loopBtn.disabled = true;
    }

    audio.addEventListener('loadedmetadata', () => {
      mediaReady = true;
      if (configuredDuration && audio.duration < audioOffset + configuredDuration - 0.5) {
        console.warn('Configured audio range exceeds media duration', lesson.id);
      }
      if (items.length && items[items.length - 1].end <= items[items.length - 1].start) {
        items[items.length - 1].end = relativeDuration();
      }
      if (durationEl) durationEl.textContent = formatTime(relativeDuration());
      setAudioPosition(0);
      updatePlayerUI();
    });

    audio.addEventListener('timeupdate', updatePlayerUI);
    audio.addEventListener('play', () => {
      if (playIcon) playIcon.style.display = 'none';
      if (pauseIcon) pauseIcon.style.display = 'block';
      ensureMonitor();
    });
    audio.addEventListener('pause', () => {
      if (playIcon) playIcon.style.display = 'block';
      if (pauseIcon) pauseIcon.style.display = 'none';
    });

    playPauseBtn?.addEventListener('click', () => audio.paused ? playContinuous() : audio.pause());

    if (timeline) {
      timeline.min = '0'; timeline.max = '100'; timeline.step = '0.1';
      timeline.addEventListener('input', () => {
        isSeeking = true;
        const t = (Number(timeline.value) / 100) * relativeDuration();
        if (currentTimeEl) currentTimeEl.textContent = formatTime(t);
      });
      timeline.addEventListener('change', () => {
        pointMode = false; pointEndAbs = null;
        setAudioPosition((Number(timeline.value) / 100) * relativeDuration());
        isSeeking = false; updatePlayerUI();
      });
    }

    const savedSpeed = Number(localStorage.getItem(`learning_playback_speed_${book.id}`) || localStorage.getItem('nce_playback_speed') || 1);
    if (speedSelect) {
      speedSelect.value = String(savedSpeed);
      audio.playbackRate = savedSpeed;
      speedSelect.addEventListener('change', () => {
        audio.playbackRate = Number(speedSelect.value || 1);
        localStorage.setItem(`learning_playback_speed_${book.id}`, speedSelect.value);
      });
    }

    const savedVolume = Number(localStorage.getItem('learning_audio_volume') ?? localStorage.getItem('nce_audio_volume') ?? 1);
    audio.volume = Math.max(0, Math.min(1, savedVolume));
    if (volumeSlider) volumeSlider.value = String(audio.volume * 100);
    volumeBtn?.addEventListener('click', () => {
      audio.muted = !audio.muted;
      if (volumeIcon) volumeIcon.style.display = audio.muted ? 'none' : 'block';
      if (muteIcon) muteIcon.style.display = audio.muted ? 'block' : 'none';
    });
    volumeSlider?.addEventListener('input', () => {
      audio.volume = Number(volumeSlider.value) / 100;
      audio.muted = false;
      localStorage.setItem('learning_audio_volume', String(audio.volume));
      if (volumeIcon) volumeIcon.style.display = 'block';
      if (muteIcon) muteIcon.style.display = 'none';
    });

    loopBtn?.addEventListener('click', () => {
      loopMode = !loopMode;
      loopBtn.classList.toggle('active', loopMode);
      loopBtn.setAttribute('aria-pressed', String(loopMode));
      if (loopMode && activeIdx >= 0 && canPoint(items[activeIdx], activeIdx) && !audio.paused) {
        pointMode = true;
        pointEndAbs = audioOffset + validEnd(items[activeIdx], activeIdx);
      }
    });

    dictationBtn?.addEventListener('click', () => {
      dictationMode = !dictationMode;
      revealed.clear();
      dictationBtn.classList.toggle('active', dictationMode);
      render();
    });

    helpBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      helpTooltip?.classList.toggle('show');
    });
    document.addEventListener('click', () => helpTooltip?.classList.remove('show'));

    document.addEventListener('keydown', (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || '')) return;
      if (e.code === 'Space') { e.preventDefault(); audio.paused ? playContinuous() : audio.pause(); }
      if (e.key === 'ArrowLeft' && activeIdx > 0) { e.preventDefault(); playPoint(activeIdx - 1); }
      if (e.key === 'ArrowRight' && activeIdx + 1 < items.length) { e.preventDefault(); playPoint(activeIdx + 1); }
      if ((e.key === 'l' || e.key === 'L') && loopBtn) loopBtn.click();
      if ((e.key === 'r' || e.key === 'R') && activeIdx >= 0) playPoint(activeIdx);
      if (e.key === 'ArrowUp' && speedSelect) {
        e.preventDefault(); const opts = [...speedSelect.options]; const i = opts.findIndex((o) => o.value === speedSelect.value); if (i < opts.length - 1) { speedSelect.value = opts[i + 1].value; speedSelect.dispatchEvent(new Event('change')); }
      }
      if (e.key === 'ArrowDown' && speedSelect) {
        e.preventDefault(); const opts = [...speedSelect.options]; const i = opts.findIndex((o) => o.value === speedSelect.value); if (i > 0) { speedSelect.value = opts[i - 1].value; speedSelect.dispatchEvent(new Event('change')); }
      }
    });

    window.NCE_APP?.initSegmented(document);

    function saveSession() {
      const seconds = Math.max(0, (Date.now() - sessionStarted) / 1000);
      window.progressManager?.saveLessonProgress(book.id, lesson.id, {
        duration: seconds,
        sentenceCount: played.size,
        totalSentences: items.length,
        completed: items.length > 0 && played.size >= items.filter((it, i) => canPoint(it, i)).length && lesson.pointReading !== false,
        legacyId: lesson.legacyId || null,
      });
      sessionStarted = Date.now();
    }
    window.addEventListener('pagehide', saveSession);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveSession(); });
  });
})();
