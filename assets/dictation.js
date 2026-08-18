(() => {
  let initialized = false;
  let lesson = null;
  let allWords = [];
  let queue = [];
  let current = 0;
  let stage = 0; // 0 = 听发音, 1 = 看单词, 2 = 下一个
  let started = false;

  function $(id) {
    return document.getElementById(id);
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function speak(word) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    u.rate = 0.85;
    const voices = window.speechSynthesis.getVoices();
    const en = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('en'));
    if (en) u.voice = en;
    window.speechSynthesis.speak(u);
  }

  function renderCard() {
    const item = queue[current];
    $('dictProgress').textContent = `第 ${current + 1} / ${queue.length} 个单词`;
    $('dictStageHint').textContent = '点击卡片，先听发音';
    $('dictFront').hidden = false;
    $('dictBack').hidden = true;
    $('dictCard').classList.remove('revealed', 'listening');
    stage = 0;
  }

  function revealCard() {
    const item = queue[current];
    $('dictBack').innerHTML = `
      <div class="dict-flash-word">${item.word}</div>
      <div class="dict-flash-meta">/${item.phonetic || '—'}/ · ${item.pos} · ${item.meaning}</div>
    `;
    $('dictFront').hidden = true;
    $('dictBack').hidden = false;
    $('dictStageHint').textContent = '再点一下，看下一个单词';
    $('dictCard').classList.add('revealed');
    stage = 2;
  }

  function nextOrFinish() {
    current++;
    if (current < queue.length) {
      renderCard();
    } else {
      finish();
    }
  }

  function finish() {
    const key = `nce2_flash_${lesson.id}`;
    const prev = JSON.parse(localStorage.getItem(key) || '{}');
    localStorage.setItem(
      key,
      JSON.stringify({ lastCount: queue.length, lastAt: Date.now(), best: Math.max(prev.best || 0, queue.length) })
    );

    $('dictSummary').innerHTML = queue
      .map(
        (item) => `
          <div class="dict-summary-item">
            <div class="dict-summary-word">${item.word}</div>
            <div class="dict-summary-meta">/${item.phonetic || '—'}/ · ${item.pos} · ${item.meaning}</div>
          </div>
        `
      )
      .join('');
    $('dictQuiz').hidden = true;
    $('dictResult').hidden = false;
    started = false;
  }

  function start(scope) {
    const pool = scope === 'key' ? allWords.filter((w) => w.key) : allWords;
    if (!pool.length) {
      alert('本课没有可练习的单词');
      return;
    }
    queue = shuffle(pool);
    current = 0;
    started = true;
    $('dictQuiz').hidden = false;
    $('dictResult').hidden = true;
    renderCard();
  }

  async function init() {
    if (initialized) return;
    initialized = true;

    try {
      lesson = await window.NCE_COMMON.getCurrentLesson();
      const res = await fetch('data/words.json');
      const words = await res.json();
      allWords = words[String(lesson.id)] || [];
      $('dictWordCount').textContent = `本课重点词汇 ${allWords.length} 个，其中重点词 ${allWords.filter((w) => w.key).length} 个`;
    } catch (err) {
      $('dictWordCount').textContent = '单词加载失败：' + err.message;
    }

    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }

    $('dictStart').addEventListener('click', () => start($('dictScope').value));
    $('dictRestart').addEventListener('click', () => start($('dictScope').value));
    $('dictCard').addEventListener('click', () => {
      if (!started || !queue[current]) return;
      if (stage === 0) {
        speak(queue[current].word);
        $('dictStageHint').textContent = '再点一下，显示单词';
        $('dictCard').classList.add('listening');
        stage = 1;
      } else if (stage === 1) {
        revealCard();
      } else if (stage === 2) {
        nextOrFinish();
      }
    });
  }

  window.NCE_DICTATION = { init };
})();
