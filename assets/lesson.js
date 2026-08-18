(() => {
  const LINE_RE = /^((?:\[\d+:\d+(?:\.\d+)?\])+)(.*)$/;
  const TIME_RE = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
  const META_RE = /^\[(al|ar|ti|by):(.+)\]$/i;

  function timeTagsToSeconds(tags){
    // Use the first tag as start
    const m = /\[(\d+):(\d+(?:\.\d+)?)\]/.exec(tags);
    if(!m) return 0;
    return parseInt(m[1],10)*60 + parseFloat(m[2]);
  }

  function hasCJK(s){return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(s)}

  async function fetchText(url){ const r = await fetch(url); if(!r.ok) throw new Error('Fetch failed '+url); return await r.text(); }

  async function loadLrc(url){
    const text = await fetchText(url);
    const rows = text.replace(/\r/g,'').split('\n');
    const meta = {al:'',ar:'',ti:'',by:''};
    const items = [];
    for(let i=0;i<rows.length;i++){
      const raw = rows[i].trim(); if(!raw) continue;
      const mm = raw.match(META_RE); if(mm){ meta[mm[1].toLowerCase()] = mm[2].trim(); continue; }
      const m = raw.match(LINE_RE); if(!m) continue;
      const tags = m[1];
      const start = timeTagsToSeconds(tags);
      let body = m[2].trim();
      let en = body, cn = '';
      if(body.includes('|')){ const parts = body.split('|'); en = parts[0].trim(); cn = (parts[1]||'').trim(); }
      else {
        // stacked mode: next line may be CN with same timestamp
        if(i+1<rows.length){
          const m2 = rows[i+1].trim().match(LINE_RE);
          if(m2 && m2[1]===tags){
            const text2 = m2[2].trim();
            if(hasCJK(text2)){ cn = text2; i++; }
          }
        }
      }
      items.push({start,en,cn});
    }
    // compute end time
    for(let i=0;i<items.length;i++){
      // For last item, we'll use audio duration later or fallback in computeEnd
      items[i].end = i+1<items.length ? items[i+1].start : 0;
    }
    return {meta, items};
  }

  function qs(sel){ return document.querySelector(sel); }

  document.addEventListener('DOMContentLoaded',()=>{
    // Ensure new lesson loads at top (avoid scroll restoration)
    try { if ('scrollRestoration' in history) { history.scrollRestoration = 'manual'; } } catch(_){}
    window.scrollTo(0, 0);
    const hash = decodeURIComponent(location.hash.slice(1));
    if(!hash){ location.href = 'book.html'; return; }
    const [book, ...rest] = hash.split('/');
    const base = rest.join('/'); // filename
    const inModern = /\/modern\//.test(location.pathname);
    const prefix = inModern ? '../' : '';
    const mp3 = `${prefix}${book}/${base}.mp3`;
    const lrc = `${prefix}${book}/${base}.lrc`;

    const titleEl = qs('#lessonTitle');
    const subEl = qs('#lessonSub');
    const listEl = qs('#sentences');
    const audio = qs('#player');
    const backLink = qs('#backLink');
    const prevLessonLink = qs('#prevLesson');
    const nextLessonLink = qs('#nextLesson');
    const speedSelect = qs('#speedSelect');
    const loopBtn = qs('#loopBtn');
    const helpBtn = qs('#helpBtn');
    const helpTooltip = qs('#helpTooltip');
    const dictationBtn = qs('#dictationBtn');
    const playPauseBtn = qs('#playPauseBtn');
    const playIcon = qs('#playIcon');
    const pauseIcon = qs('#pauseIcon');
    const timeline = qs('#timeline');
    const currentTimeEl = qs('#currentTime');
    const durationEl = qs('#duration');
    const volumeBtn = qs('#volumeBtn');
    const volumeIcon = qs('#volumeIcon');
    const muteIcon = qs('#muteIcon');
    const volumeSlider = qs('#volumeSlider');

    let items = [];
    let idx = -1;
    let segmentEnd = 0; // current sentence end time
    let segmentTimer = 0; // timeout id for auto-advance
    let prevLessonHref = '';
    let nextLessonHref = '';
    
    // Progress tracking
    let sessionStartTime = Date.now();
    let sessionDuration = 0;
    let sentencesPlayed = new Set();
    
    // Playback settings
    let loopMode = false;
    let playbackSpeed = parseFloat(localStorage.getItem('nce_playback_speed') || '1');
    let dictationMode = false;
    let revealedSentences = new Set();

    audio.src = mp3;

    // Custom player controls
    function formatTime(seconds) {
      if(isNaN(seconds)) return '0:00';
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Play/Pause button
    if(playPauseBtn) {
      playPauseBtn.addEventListener('click', () => {
        if(audio.paused) {
          audio.play();
        } else {
          audio.pause();
        }
      });
    }

    // Update play/pause icon
    audio.addEventListener('play', () => {
      if(playIcon && pauseIcon) {
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
      }
    });

    audio.addEventListener('pause', () => {
      if(playIcon && pauseIcon) {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
      }
    });

    // Timeline
    let isSeeking = false;
    if(timeline) {
      timeline.addEventListener('input', () => {
        isSeeking = true;
        const time = (timeline.value / 100) * audio.duration;
        if(currentTimeEl) currentTimeEl.textContent = formatTime(time);
      });

      timeline.addEventListener('change', () => {
        const time = (timeline.value / 100) * audio.duration;
        audio.currentTime = time;
        isSeeking = false;
      });
    }

    // Duration
    audio.addEventListener('loadedmetadata', () => {
      if(durationEl) durationEl.textContent = formatTime(audio.duration);
      if(timeline) timeline.max = 100;

      // Update end time for the last item based on actual audio duration
      if(items.length > 0 && items[items.length - 1].end === 0) {
        items[items.length - 1].end = audio.duration;
      }
    });

    // Volume button
    if(volumeBtn) {
      volumeBtn.addEventListener('click', () => {
        audio.muted = !audio.muted;
        if(volumeIcon && muteIcon) {
          volumeIcon.style.display = audio.muted ? 'none' : 'block';
          muteIcon.style.display = audio.muted ? 'block' : 'none';
        }
      });
    }

    // Volume slider
    if(volumeSlider) {
      // Restore saved volume
      const savedVolume = localStorage.getItem('nce_audio_volume');
      if(savedVolume !== null) {
        audio.volume = parseFloat(savedVolume);
        volumeSlider.value = audio.volume * 100;
      }

      volumeSlider.addEventListener('input', () => {
        audio.volume = volumeSlider.value / 100;
        audio.muted = false;
        localStorage.setItem('nce_audio_volume', audio.volume);
        if(volumeIcon && muteIcon) {
          volumeIcon.style.display = 'block';
          muteIcon.style.display = 'none';
        }
      });
    }
    // Back navigation: prefer history, fallback to index with current book
    if(backLink){
      const fallback = `index.html#${book}`;
      backLink.setAttribute('href', fallback);
      backLink.addEventListener('click', (e)=>{
        e.preventDefault();
        try{
          const ref = document.referrer;
          if(ref && new URL(ref).origin === location.origin){ history.back(); return; }
        }catch(_){}
        location.href = fallback;
      });
    }

    function render(){
      listEl.innerHTML = items.map((it, i)=>{
        const isRevealed = revealedSentences.has(i);
        const displayClass = dictationMode && !isRevealed ? 'hidden-text' : '';
        const isFavorited = window.favoritesManager?.isFavorite(book, base, i);
        
        return `
          <div class="sentence ${displayClass}" data-idx="${i}">
            <button class="favorite-btn ${isFavorited ? 'active' : ''}" data-idx="${i}" title="收藏句子">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2.866 14.85c-.078.444.36.791.746.593l4.39-2.256 4.389 2.256c.386.198.824-.149.746-.592l-.83-4.73 3.523-3.356c.329-.314.158-.888-.283-.95l-4.898-.696L8.465.792a.513.513 0 0 0-.927 0L5.354 5.12l-4.898.696c-.441.062-.612.636-.283.95l3.523 3.356-.83 4.73zm4.905-2.767l-3.686 1.894.694-3.957a.565.565 0 0 0-.163-.505L1.71 6.745l4.052-.576a.525.525 0 0 0 .393-.288l1.847-3.658 1.846 3.658a.525.525 0 0 0 .393.288l4.052.575-2.906 2.77a.564.564 0 0 0-.163.506l.694 3.957-3.686-1.894a.503.503 0 0 0-.461 0z"/>
              </svg>
            </button>
            <div class="sentence-content">
              <div class="en">${it.en}</div>
              ${it.cn?`<div class="cn">${it.cn}</div>`:''}
            </div>
            ${dictationMode && !isRevealed ? '<div class="reveal-hint">点击显示文本</div>' : ''}
          </div>
        `;
      }).join('');
      
      // Add event listeners for favorite buttons
      listEl.querySelectorAll('.favorite-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.idx);
          const item = items[idx];
          const isNowFavorited = window.favoritesManager?.toggleFavorite(book, base, idx, item);
          btn.classList.toggle('active', isNowFavorited);
          
          // Update star icon
          const path = btn.querySelector('path');
          if(isNowFavorited) {
            path.setAttribute('d', 'M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z');
            showNotification('已收藏');
          } else {
            path.setAttribute('d', 'M2.866 14.85c-.078.444.36.791.746.593l4.39-2.256 4.389 2.256c.386.198.824-.149.746-.592l-.83-4.73 3.523-3.356c.329-.314.158-.888-.283-.95l-4.898-.696L8.465.792a.513.513 0 0 0-.927 0L5.354 5.12l-4.898.696c-.441.062-.612.636-.283.95l3.523 3.356-.83 4.73zm4.905-2.767l-3.686 1.894.694-3.957a.565.565 0 0 0-.163-.505L1.71 6.745l4.052-.576a.525.525 0 0 0 .393-.288l1.847-3.658 1.846 3.658a.525.525 0 0 0 .393.288l4.052.575-2.906 2.77a.564.564 0 0 0-.163.506l.694 3.957-3.686-1.894a.503.503 0 0 0-.461 0z');
            showNotification('已取消收藏');
          }
        });
      });
    }

    function computeEnd(it){
      // If no end time or invalid end time, estimate based on audio duration or use default
      if(!it.end || it.end <= it.start) {
        // For last item or missing end time, use a default duration
        return it.start + 3.0; // Default 3 seconds per sentence
      }
      // ensure a minimal segment duration to avoid too-short loops
      const minDur = 0.6; // seconds
      return Math.max(it.end, it.start + minDur);
    }

    function clearAdvance(){ if(segmentTimer){ clearTimeout(segmentTimer); segmentTimer = 0; } }

    function scheduleAdvance(){
      clearAdvance();
      if(idx >= 0 && idx < items.length && !loopMode){
        const ms = Math.max(0, (segmentEnd - audio.currentTime) * 1000);
        segmentTimer = setTimeout(()=>{
          if(idx+1 < items.length && !loopMode){
            playSegment(idx+1);
          } else {
            // last sentence of lesson: stop here
            audio.pause();
          }
        }, ms);
      }
    }

// 检查seekable范围的辅助函数
function canSeekTo(time) {
  if(!audio.seekable || audio.seekable.length === 0) return false;
  for(let j = 0; j < audio.seekable.length; j++) {
    if(time >= audio.seekable.start(j) && time <= audio.seekable.end(j)) {
      return true;
    }
  }
  return false;
}

function playSegment(i){
      if(i<0 || i>=items.length) return;
      idx = i;
      const it = items[i];

      // 尝试跳转到指定时间
      if(canSeekTo(it.start)) {
        audio.currentTime = Math.max(0, it.start);
        segmentEnd = computeEnd(it);
        const p = audio.play();
        if(p && p.catch){ p.catch(()=>{}); }
      } else {
        // 无法跳转：从头开始播放
        segmentEnd = computeEnd(it);
        if(audio.paused) {
          const p = audio.play();
          if(p && p.catch){ p.catch(()=>{}); }
        }
      }
    }

    function highlight(i, smooth=true){
      const prev = listEl.querySelector('.sentence.active');
      if(prev) prev.classList.remove('active');
      const cur = listEl.querySelector(`.sentence[data-idx="${i}"]`);
      if(cur){
        cur.classList.add('active');
        if(smooth) {
          cur.scrollIntoView({behavior:'smooth', block:'center'});
        } else {
          // 首次加载时不滚动
          const containerRect = listEl.getBoundingClientRect();
          const elementRect = cur.getBoundingClientRect();
          if(elementRect.bottom > containerRect.bottom || elementRect.top < containerRect.top) {
            cur.scrollIntoView({behavior:'auto', block:'center'});
          }
        }
      }
    }

    listEl.addEventListener('click', e=>{
      // Ignore clicks on favorite buttons
      if(e.target.closest('.favorite-btn')) return;
      
      const s = e.target.closest('.sentence'); 
      if(!s) return;
      
      const idx = parseInt(s.dataset.idx, 10);
      
      if(dictationMode && !revealedSentences.has(idx)) {
        // In dictation mode, first click reveals text
        revealedSentences.add(idx);
        s.classList.remove('hidden-text');
        s.querySelector('.reveal-hint')?.remove();
      } else {
        // Normal mode or already revealed: play the sentence
        playSegment(idx);
      }
    });

    audio.addEventListener('timeupdate', ()=>{
      const t = audio.currentTime;

      // Update timeline and time display
      if(!isSeeking && audio.duration && timeline) {
        timeline.value = (t / audio.duration) * 100;
        if(currentTimeEl) currentTimeEl.textContent = formatTime(t);
      }

      // Update current index/highlight
      if(!loopMode) {  // 只在非循环模式下更新索引
        for(let i=0;i<items.length;i++){
          const it = items[i];
          const segEnd = computeEnd(it);
          const within = t >= it.start && t < segEnd;
          if(within){
            if(idx!==i){
              idx=i;
              segmentEnd = segEnd;
              highlight(i);
              // Only reschedule if playing and not already scheduled
              if(!audio.paused && !segmentTimer) {
                scheduleAdvance();
              }
            }
            break;
          }
        }
      }
    });

    // User control: when paused, stop auto-advance; when resumed, re-schedule
    audio.addEventListener('pause', () => {
      clearAdvance();
    });
    audio.addEventListener('play', () => {
      // Only schedule if not already scheduled and we have a valid index
      if(!segmentTimer && idx >= 0 && idx < items.length) {
        scheduleAdvance();
      }
    });
    
    // Handle when audio reaches the end naturally
    audio.addEventListener('ended', () => {
      clearAdvance();
      // Optionally reset to beginning
      idx = -1;
    });

    // Handle lesson change via hash navigation (prev/next buttons)
    window.addEventListener('hashchange', () => {
      // Scroll to top then reload to re-init content
      window.scrollTo(0, 0);
      location.reload();
    });

    // Resolve neighbors and wire bottom nav
    async function resolveLessonNeighbors(){
      try{
        const num = parseInt(book.replace('NCE','')) || 1;
        const res = await fetch(prefix + 'static/data.json');
        const data = await res.json();
        const lessons = data[num] || [];
        const i = lessons.findIndex(x => x.filename === base);
        if(i > 0){
          const prev = lessons[i-1].filename;
          prevLessonHref = `lesson.html#${book}/${prev}`;
          if(prevLessonLink){ prevLessonLink.href = prevLessonHref; prevLessonLink.style.display = ''; }
        }else{
          if(prevLessonLink){ prevLessonLink.style.display = 'none'; }
        }
        if(i >= 0 && i+1 < lessons.length){
          const next = lessons[i+1].filename;
          nextLessonHref = `lesson.html#${book}/${next}`;
          if(nextLessonLink){ nextLessonLink.href = nextLessonHref; nextLessonLink.style.display = ''; }
        }else{
          if(nextLessonLink){ nextLessonLink.style.display = 'none'; }
        }
      }catch(_){
        if(prevLessonLink) prevLessonLink.style.display = 'none';
        if(nextLessonLink) nextLessonLink.style.display = 'none';
      }
    }

    NCE_APP.initSegmented(document);

    resolveLessonNeighbors();
    
    // Initialize speed control
    if(speedSelect) {
      speedSelect.value = playbackSpeed;
      audio.playbackRate = playbackSpeed;
      
      speedSelect.addEventListener('change', () => {
        playbackSpeed = parseFloat(speedSelect.value);
        audio.playbackRate = playbackSpeed;
        localStorage.setItem('nce_playback_speed', playbackSpeed);
      });
    }
    
    // 循环模式处理函数
function loopHandler() {
  if(loopMode && idx >= 0 && idx < items.length) {
    const currentSentence = items[idx];
    const loopStart = currentSentence.start;
    const loopEnd = computeEnd(currentSentence);

    // 检查是否可以跳转
    if(canSeekTo(loopStart)) {
      audio.currentTime = loopStart;
    }

    audio.play().catch(()=>{});
    const loopMs = Math.max(0, (loopEnd - loopStart) * 1000);
    segmentTimer = setTimeout(loopHandler, loopMs);
  }
}

// Initialize loop control
    if(loopBtn) {
      loopBtn.addEventListener('click', () => {
        loopMode = !loopMode;
        loopBtn.classList.toggle('active', loopMode);
        loopBtn.title = loopMode ? '单句循环 (开启)' : '单句循环 (关闭)';

        // Show notification
        const msg = loopMode ? '单句循环已开启' : '单句循环已关闭';
        showNotification(msg);

        // Handle loop mode logic
        if(loopMode && idx >= 0 && idx < items.length) {
          // If currently playing and loop mode enabled, set up loop
          if(!audio.paused) {
            clearAdvance();
            const currentSentence = items[idx];
            const loopEnd = computeEnd(currentSentence);
            const ms = Math.max(0, (loopEnd - audio.currentTime) * 1000);
            segmentTimer = setTimeout(loopHandler, ms);
          }
        } else {
          // If exiting loop mode, resume normal advance
          if(!audio.paused && idx >= 0 && idx < items.length) {
            scheduleAdvance();
          }
        }
      });
    }
    
    // Initialize dictation mode
    if(dictationBtn) {
      dictationBtn.addEventListener('click', () => {
        dictationMode = !dictationMode;
        dictationBtn.classList.toggle('active', dictationMode);
        dictationBtn.title = dictationMode ? '听写模式 (开启)' : '听写模式 (关闭)';
        document.body.classList.toggle('dictation-mode', dictationMode);
        
        if(dictationMode) {
          // Entering dictation mode: reset revealed sentences
          revealedSentences.clear();
          showNotification('听写模式已开启 - 文本已隐藏');
        } else {
          // Exiting dictation mode: show all text
          revealedSentences.clear();
          showNotification('听写模式已关闭');
        }
        
        // Re-render to apply/remove hiding
        render();
      });
    }
    
    // Initialize help tooltip
    if(helpBtn && helpTooltip) {
      let tooltipTimer;
      let isTooltipPinned = false;
      
      const showTooltip = () => {
        helpTooltip.classList.add('show');
      };
      
      const hideTooltip = () => {
        if(!isTooltipPinned) {
          helpTooltip.classList.remove('show');
        }
      };
      
      // Show on hover
      helpBtn.addEventListener('mouseenter', () => {
        clearTimeout(tooltipTimer);
        showTooltip();
      });
      
      helpBtn.addEventListener('mouseleave', () => {
        tooltipTimer = setTimeout(hideTooltip, 200);
      });
      
      // Keep open when hovering tooltip
      helpTooltip.addEventListener('mouseenter', () => {
        clearTimeout(tooltipTimer);
      });
      
      helpTooltip.addEventListener('mouseleave', () => {
        tooltipTimer = setTimeout(hideTooltip, 200);
      });
      
      // Toggle on click
      helpBtn.addEventListener('click', () => {
        isTooltipPinned = !isTooltipPinned;
        if(isTooltipPinned) {
          showTooltip();
        } else {
          hideTooltip();
        }
      });
      
      // Close when clicking outside
      document.addEventListener('click', (e) => {
        if(!helpBtn.contains(e.target) && !helpTooltip.contains(e.target)) {
          isTooltipPinned = false;
          hideTooltip();
        }
      });
    }
    
    // Show notification function
    function showNotification(message) {
      const notif = document.createElement('div');
      notif.className = 'notification';
      notif.textContent = message;
      document.body.appendChild(notif);
      
      setTimeout(() => {
        notif.classList.add('show');
      }, 10);
      
      setTimeout(() => {
        notif.classList.remove('show');
        setTimeout(() => {
          document.body.removeChild(notif);
        }, 300);
      }, 2000);
    }
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Ignore if typing in an input field
      if(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Don't interfere with browser shortcuts (Cmd/Ctrl + key)
      if(e.metaKey || e.ctrlKey) return;

      switch(e.key) {
        case ' ':
        case 'Spacebar':
          e.preventDefault();
          if(audio.paused) {
            audio.play();
          } else {
            audio.pause();
          }
          break;

        case 'ArrowLeft':
          e.preventDefault();
          if(idx > 0) {
            playSegment(idx - 1);
          }
          break;

        case 'ArrowRight':
          e.preventDefault();
          if(idx < items.length - 1) {
            playSegment(idx + 1);
          }
          break;

        case 'ArrowUp':
          e.preventDefault();
          if(speedSelect) {
            const currentIndex = speedSelect.selectedIndex;
            if(currentIndex < speedSelect.options.length - 1) {
              speedSelect.selectedIndex = currentIndex + 1;
              speedSelect.dispatchEvent(new Event('change'));
            }
          }
          break;

        case 'ArrowDown':
          e.preventDefault();
          if(speedSelect) {
            const currentIndex = speedSelect.selectedIndex;
            if(currentIndex > 0) {
              speedSelect.selectedIndex = currentIndex - 1;
              speedSelect.dispatchEvent(new Event('change'));
            }
          }
          break;

        case 'l':
        case 'L':
          e.preventDefault();
          if(loopBtn) {
            loopBtn.click();
          }
          break;

        case 'r':
        case 'R':
          e.preventDefault();
          // Restart current sentence
          if(idx >= 0) {
            playSegment(idx);
          }
          break;
      }
    });
    
    // Save progress when leaving the page
    window.addEventListener('beforeunload', () => {
      sessionDuration = Math.floor((Date.now() - sessionStartTime) / 1000);
      if(window.progressManager && sessionDuration > 0) {
        window.progressManager.saveLessonProgress(book, base, {
          duration: sessionDuration,
          sentenceCount: sentencesPlayed.size,
          completed: sentencesPlayed.size === items.length
        });
      }
    });

    loadLrc(lrc).then(({meta,items:arr})=>{
      items = arr;
      titleEl.textContent = meta.ti || base;
      subEl.textContent = `${meta.al || book} · ${meta.ar||''}`.trim();
      render();

      // Initialize progress for this lesson
      if(window.progressManager) {
        const progress = window.progressManager.getLessonProgress(book, base) || {};
        progress.totalSentences = items.length;
        window.progressManager.saveLessonProgress(book, base, progress);
      }

      // Auto-play first sentence
      if(items.length > 0) {
        // Wait for audio to be ready before playing
        if(audio.readyState >= 1) {
          playSegment(0);
        } else {
          audio.addEventListener('canplay', () => playSegment(0), { once: true });
        }
        // 首次加载时高亮第一句但不滚动
        highlight(0, false);
      }
    }).catch(err=>{
      titleEl.textContent = '无法加载课文';
      subEl.textContent = String(err);
    });
  });
})();
