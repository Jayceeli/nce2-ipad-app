(() => {
  const DATA_BASE = 'https://raw.githubusercontent.com/Jayceeli/hujiao-grade5-english/main/';
  const AUDIO_URL = 'https://jayceeli.github.io/hujiao-grade5-english/assets/audio-sprite.ogg';
  const BOOK_ID = 'SHG5A2026';

  let catalog = null;
  let manifest = null;
  let pointMap = null;
  let unit = null;
  let audio = null;
  let pointItems = [];
  let activePointIndex = -1;
  let activeStart = null;
  let activeEnd = null;
  let activeEl = null;
  let loopMode = false;
  let monitorId = null;
  let sequence = [];
  let sequencePos = -1;
  let sequenceMode = false;
  let sessionStart = Date.now();

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const fmt = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  }

  function clearActive() {
    if (activeEl) activeEl.classList.remove('active');
    activeEl = null;
  }

  function stopMonitor() {
    if (monitorId) cancelAnimationFrame(monitorId);
    monitorId = null;
  }

  function resetSequence() {
    sequenceMode = false;
    sequence = [];
    sequencePos = -1;
  }

  function ensureMonitor() {
    if (monitorId) return;
    const tick = () => {
      monitorId = requestAnimationFrame(tick);
      if (!audio || audio.paused || activeEnd == null) return;
      updateTimeline();
      if (audio.currentTime >= activeEnd - 0.02) {
        if (sequenceMode && sequencePos < sequence.length - 1) {
          sequencePos += 1;
          cuePoint(sequence[sequencePos], true);
          return;
        }
        if (sequenceMode && sequencePos >= sequence.length - 1) {
          audio.pause();
          activeStart = activeEnd = null;
          resetSequence();
          clearActive();
          stopMonitor();
          $('#audioStatus').textContent = '本节精校正文播放完成';
          return;
        }
        if (loopMode && activeStart != null) {
          audio.currentTime = activeStart;
          audio.play().catch(() => {});
          return;
        }
        audio.pause();
        activeStart = activeEnd = null;
        clearActive();
        stopMonitor();
      }
    };
    monitorId = requestAnimationFrame(tick);
  }

  function updateTimeline() {
    if (activeStart == null || activeEnd == null || activeEnd <= activeStart) return;
    const elapsed = Math.max(0, Math.min(activeEnd, audio.currentTime) - activeStart);
    const dur = activeEnd - activeStart;
    $('#timeline').value = String((elapsed / dur) * 100);
    $('#currentTime').textContent = fmt(elapsed);
    $('#duration').textContent = fmt(dur);
  }

  function setPlayIcon(playing) {
    $('#playIcon').style.display = playing ? 'none' : 'block';
    $('#pauseIcon').style.display = playing ? 'block' : 'none';
  }

  function pointRow(section) {
    return pointMap?.tracks?.[section.track] || null;
  }

  function sectionSegments(section) {
    if (Array.isArray(section.segments) && section.segments.length) return section.segments;
    const row = pointRow(section);
    return row?.segments?.length ? row.segments : null;
  }

  function splitStatic(text) {
    return String(text || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
  }

  function trackRange(track) {
    const m = manifest?.tracks?.[track];
    if (!m) return null;
    return { start: m.start, end: m.end };
  }

  function markProgress(index, duration) {
    if (!window.progressManager || !unit) return;
    const existing = window.progressManager.getLessonProgress(BOOK_ID, unit.id) || {};
    const sentences = existing.sentences || {};
    sentences[index] = {
      learned: true,
      count: (sentences[index]?.count || 0) + 1,
      lastTime: Date.now(),
      totalDuration: (sentences[index]?.totalDuration || 0) + duration
    };
    const learned = Object.values(sentences).filter(x => x?.learned).length;
    window.progressManager.saveLessonProgress(BOOK_ID, unit.id, {
      sentences,
      totalSentences: pointItems.length,
      completed: pointItems.length > 0 && learned >= pointItems.length,
      sentenceCount: 1
    });
  }

  function cueRange(start, end, label, el = null, keepSequence = false) {
    if (!audio || audio.readyState < 1) {
      $('#audioStatus').textContent = '原版音频仍在加载，请稍后再点一次';
      return;
    }
    if (!keepSequence) resetSequence();
    clearActive();
    activeEl = el;
    if (activeEl) activeEl.classList.add('active');
    activeStart = start;
    activeEnd = end;
    audio.playbackRate = parseFloat($('#speedSelect').value) || 1;
    try { audio.currentTime = start; } catch (_) {}
    $('#timeline').value = '0';
    $('#currentTime').textContent = '0:00';
    $('#duration').textContent = fmt(end - start);
    $('#audioStatus').textContent = `原版点读 · ${label}`;
    audio.play().then(() => {
      setPlayIcon(true);
      ensureMonitor();
    }).catch(() => {
      $('#audioStatus').textContent = '请再次点击句子以播放原版音频';
    });
  }

  function cuePoint(item, keepSequence = false) {
    if (!item) return;
    const base = manifest?.tracks?.[item.track];
    if (!base) return;
    activePointIndex = item.globalIndex;
    updateNavButtons();
    cueRange(base.start + item.start, base.start + item.end, item.text, item.el, keepSequence);
    markProgress(item.globalIndex, Math.max(0, item.end - item.start));
  }

  function playPoint(index) {
    const item = pointItems[index];
    if (!item) return;
    resetSequence();
    cuePoint(item, false);
    item.el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }

  function playSequence(items) {
    if (!items?.length) return;
    sequence = items;
    sequencePos = 0;
    sequenceMode = true;
    cuePoint(sequence[0], true);
  }

  function playWholeTrack(track, label, el) {
    const r = trackRange(track);
    if (!r) return;
    cueRange(r.start, r.end, label, el, false);
  }

  function updateNavButtons() {
    $('#prevPoint').disabled = activePointIndex <= 0;
    $('#nextPoint').disabled = activePointIndex < 0 || activePointIndex >= pointItems.length - 1;
  }

  function makeSectionHeader(section, hasSegments, sectionPoints) {
    const box = document.createElement('div');
    box.className = 'grade5-section';
    box.innerHTML = `<h2>${esc(section.title)}</h2><div class="section-sub">教材页 ${(section.pages || []).join(', ')}</div>`;
    if (section.track) {
      const actions = document.createElement('div');
      actions.className = 'grade5-section-actions';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = hasSegments ? '▶ 连续播放精校正文' : '🎧 播放本节原版音频';
      btn.addEventListener('click', () => {
        if (hasSegments) playSequence(sectionPoints);
        else playWholeTrack(section.track, section.title, btn);
      });
      actions.appendChild(btn);
      box.appendChild(actions);
    }
    return box;
  }

  function renderUnit() {
    pointItems = [];
    activePointIndex = -1;
    const root = $('#grade5Content');
    root.innerHTML = '';
    $('#lessonTitle').textContent = unit.title;
    $('#lessonSub').textContent = `教材 PDF 第 ${unit.pageRange[0]}–${unit.pageRange[1]} 页 · 出版社原版音频`;

    unit.sections.forEach(section => {
      const row = pointRow(section);
      const segs = sectionSegments(section);
      const sectionPoints = [];
      root.appendChild(makeSectionHeader(section, !!segs?.length, sectionPoints));

      if (section.note) {
        const note = document.createElement('p');
        note.className = 'grade5-note';
        note.textContent = section.note;
        root.appendChild(note);
      }

      if (segs?.length) {
        segs.forEach((seg, idx) => {
          const d = document.createElement('div');
          d.className = 'sentence';
          d.tabIndex = 0;
          d.setAttribute('role', 'button');
          d.innerHTML = `<span class="grade5-marker">▶</span><div class="sentence-content"><div class="en"><strong>${idx + 1}.</strong> ${esc(seg.text)}</div></div>`;
          const item = {
            track: section.track,
            start: Number(seg.start),
            end: Number(seg.end),
            text: seg.text,
            el: d,
            globalIndex: pointItems.length
          };
          pointItems.push(item);
          sectionPoints.push(item);
          const play = () => playPoint(item.globalIndex);
          d.addEventListener('click', play);
          d.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              play();
            }
          });
          root.appendChild(d);
        });

        const displayOnly = row?.displayOnly || [];
        if (displayOnly.length) {
          const note = document.createElement('p');
          note.className = 'grade5-note';
          note.textContent = row.displayOnlyNote || '以下教材文字暂未绑定可靠的逐句原版音频。';
          root.appendChild(note);
          displayOnly.forEach(text => {
            const d = document.createElement('div');
            d.className = 'sentence grade5-static grade5-unmapped';
            d.innerHTML = `<span class="grade5-marker">—</span><div class="sentence-content"><div class="en">${esc(text)}</div></div>`;
            root.appendChild(d);
          });
        }
      } else {
        splitStatic(section.text).forEach(text => {
          const d = document.createElement('div');
          d.className = 'sentence grade5-static';
          d.innerHTML = `<span class="grade5-marker"></span><div class="sentence-content"><div class="en">${esc(text)}</div></div>`;
          root.appendChild(d);
        });
      }
    });

    if (window.progressManager) {
      const current = window.progressManager.getLessonProgress(BOOK_ID, unit.id) || {};
      window.progressManager.saveLessonProgress(BOOK_ID, unit.id, {
        sentences: current.sentences || {},
        totalSentences: pointItems.length,
        completed: current.completed || false
      });
    }
    updateNavButtons();
  }

  function setupPlayer() {
    audio = $('#player');
    audio.src = AUDIO_URL;
    audio.load();

    audio.addEventListener('loadedmetadata', () => {
      $('#audioStatus').textContent = '出版社原版音频已就绪 · 点击带 ▶ 的句子开始点读';
    });
    audio.addEventListener('play', () => setPlayIcon(true));
    audio.addEventListener('pause', () => setPlayIcon(false));
    audio.addEventListener('timeupdate', updateTimeline);
    audio.addEventListener('error', () => {
      $('#audioStatus').textContent = '出版社原版音频加载失败，请检查网络后刷新';
    });

    $('#playPauseBtn').addEventListener('click', () => {
      if (audio.paused) {
        if (activeStart == null) {
          if (pointItems.length) playPoint(activePointIndex >= 0 ? activePointIndex : 0);
        } else {
          audio.play().catch(() => {});
        }
      } else {
        audio.pause();
      }
    });

    $('#timeline').addEventListener('input', e => {
      if (activeStart == null || activeEnd == null) return;
      const ratio = Number(e.target.value) / 100;
      audio.currentTime = activeStart + (activeEnd - activeStart) * ratio;
      updateTimeline();
    });

    $('#prevPoint').addEventListener('click', () => playPoint(activePointIndex - 1));
    $('#nextPoint').addEventListener('click', () => playPoint(activePointIndex + 1));
    $('#loopBtn').addEventListener('click', () => {
      loopMode = !loopMode;
      $('#loopBtn').classList.toggle('active', loopMode);
    });
    $('#speedSelect').addEventListener('change', e => {
      audio.playbackRate = parseFloat(e.target.value) || 1;
    });
  }

  function setupUnitNav(unitInfo) {
    const idx = catalog.units.findIndex(x => x.id === unitInfo.id);
    const prev = catalog.units[idx - 1];
    const next = catalog.units[idx + 1];
    const prevEl = $('#prevLesson');
    const nextEl = $('#nextLesson');
    if (prev) prevEl.href = `grade5-lesson.html#${encodeURIComponent(prev.id)}`;
    else { prevEl.style.visibility = 'hidden'; prevEl.removeAttribute('href'); }
    if (next) nextEl.href = `grade5-lesson.html#${encodeURIComponent(next.id)}`;
    else { nextEl.style.visibility = 'hidden'; nextEl.removeAttribute('href'); }
  }

  async function init() {
    setupPlayer();
    const unitId = decodeURIComponent(location.hash.slice(1) || 'starter');
    try {
      const [cat, man, pointIndex] = await Promise.all([
        getJSON(DATA_BASE + 'data/index.json'),
        getJSON(DATA_BASE + 'data/audio-sprite-manifest.json'),
        getJSON(DATA_BASE + 'data/point-v3/index.json')
      ]);
      catalog = cat;
      manifest = man;
      const info = catalog.units.find(x => x.id === unitId) || catalog.units[0];
      const pointFiles = await Promise.all(pointIndex.files.map(f => getJSON(DATA_BASE + 'data/' + f)));
      pointMap = { tracks: Object.assign({}, ...pointFiles.map(x => x.tracks || {})) };
      unit = await getJSON(DATA_BASE + 'data/' + info.file);
      renderUnit();
      setupUnitNav(info);
    } catch (err) {
      $('#lessonTitle').textContent = '教材加载失败';
      $('#lessonSub').textContent = err.message;
      $('#audioStatus').textContent = '请检查网络后刷新页面';
    }
  }

  window.addEventListener('pagehide', () => {
    if (!window.progressManager || !unit) return;
    const seconds = Math.max(0, Math.round((Date.now() - sessionStart) / 1000));
    if (!seconds) return;
    const current = window.progressManager.getLessonProgress(BOOK_ID, unit.id) || {};
    window.progressManager.saveLessonProgress(BOOK_ID, unit.id, {
      duration: seconds,
      sentences: current.sentences || {},
      totalSentences: current.totalSentences || pointItems.length,
      completed: current.completed || false
    });
  });

  document.addEventListener('DOMContentLoaded', init);
})();
