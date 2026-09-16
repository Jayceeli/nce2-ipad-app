(() => {
  const DATA_URL = new URL('data/grade5-quizzes.json', document.baseURI).href;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const unitId = () => decodeURIComponent(location.hash.slice(1) || 'starter');
  let unitQuiz = null;
  let mode = 'all';

  function addStyles() {
    if (document.getElementById('grade5QuizStyle')) return;
    const style = document.createElement('style');
    style.id = 'grade5QuizStyle';
    style.textContent = `
      .g5q-head{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;margin-bottom:16px}
      .g5q-actions{display:flex;gap:8px;flex-wrap:wrap}.g5q-actions button{font:inherit}
      .g5q-summary{padding:12px 14px;border-radius:14px;background:rgba(127,127,127,.08);margin:12px 0 18px;line-height:1.6}
      .g5q-section-title{margin:28px 0 10px;padding-bottom:7px;border-bottom:1px solid rgba(127,127,127,.18)}
      .g5q-card{margin:12px 0;padding:16px;border:1px solid rgba(127,127,127,.2);border-radius:16px;background:var(--card,#fff)}
      .g5q-card.correct{border-color:rgba(45,145,75,.55)}.g5q-card.wrong{border-color:rgba(210,65,65,.62)}
      .g5q-num{font-size:12px;font-weight:700;color:var(--muted,#777);margin-bottom:7px}
      .g5q-prompt{font-size:17px;line-height:1.65;margin:0 0 12px}
      .g5q-options{display:grid;gap:8px}.g5q-option{display:flex;gap:9px;align-items:flex-start;padding:10px 11px;border:1px solid rgba(127,127,127,.16);border-radius:11px;cursor:pointer}
      .g5q-option input{margin-top:3px}.g5q-input,.g5q-writing{width:100%;box-sizing:border-box;border:1px solid rgba(127,127,127,.28);border-radius:11px;padding:11px 12px;font:inherit;color:inherit;background:var(--card,#fff)}
      .g5q-writing{min-height:125px;line-height:1.6;resize:vertical}
      .g5q-feedback{display:none;margin-top:12px;padding-top:10px;border-top:1px dashed rgba(127,127,127,.2);line-height:1.6}
      .g5q-card.correct .g5q-feedback,.g5q-card.wrong .g5q-feedback,.g5q-card.reviewed .g5q-feedback{display:block}
      .g5q-answer{font-weight:700}.g5q-error{color:#b42318}.g5q-ok{color:#16763b}
      .g5q-submit{margin:22px 0 8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
      .g5q-result{font-size:18px;font-weight:700}.g5q-muted{color:var(--muted,#777)}
      .g5q-checklist{margin:7px 0 0}.g5q-sample{white-space:pre-wrap}
      @media(max-width:640px){.g5q-card{padding:14px}.g5q-prompt{font-size:16px}.g5q-actions{width:100%}.g5q-actions .btn{flex:1}}
    `;
    document.head.appendChild(style);
  }

  function wrongKey() { return `nce2_grade5_quiz_wrong_${unitId()}`; }
  function resultKey() { return `nce2_grade5_quiz_result_${unitId()}`; }

  function getWrongSet() {
    try { return new Set(JSON.parse(localStorage.getItem(wrongKey()) || '[]')); }
    catch (_) { return new Set(); }
  }
  function saveWrongSet(set) {
    localStorage.setItem(wrongKey(), JSON.stringify([...set]));
  }

  function normalize(s) {
    return String(s ?? '')
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .trim().toLowerCase()
      .replace(/[.?!，。！？]+$/g, '')
      .replace(/\s+/g, ' ');
  }

  function isCorrect(q, card) {
    if (q.type === 'mcq') {
      const picked = card.querySelector('input[type=radio]:checked');
      return picked ? Number(picked.value) === Number(q.answer) : false;
    }
    if (q.type === 'input') {
      const value = normalize(card.querySelector('input[type=text]')?.value);
      const accepted = [q.answer, ...(q.accepted || [])].map(normalize);
      return accepted.includes(value);
    }
    return null;
  }

  function answerText(q) {
    if (q.type === 'mcq') return q.choices?.[q.answer] ?? '';
    return q.answer ?? '';
  }

  function renderQuestion(q, index) {
    if (q.type === 'mcq') {
      return `<article class="g5q-card" data-qid="${esc(q.id)}" data-type="mcq">
        <div class="g5q-num">第 ${index + 1} 题 · ${esc(q.section)}</div>
        <p class="g5q-prompt">${esc(q.prompt)}</p>
        <div class="g5q-options">${(q.choices || []).map((c, i) => `<label class="g5q-option"><input type="radio" name="g5q_${esc(q.id)}" value="${i}"><span>${String.fromCharCode(65+i)}. ${esc(c)}</span></label>`).join('')}</div>
        <div class="g5q-feedback"><div>正确答案：<span class="g5q-answer">${esc(answerText(q))}</span></div>${q.explanation ? `<div class="g5q-muted">${esc(q.explanation)}</div>` : ''}</div>
      </article>`;
    }
    if (q.type === 'input') {
      return `<article class="g5q-card" data-qid="${esc(q.id)}" data-type="input">
        <div class="g5q-num">第 ${index + 1} 题 · ${esc(q.section)}</div>
        <p class="g5q-prompt">${esc(q.prompt)}</p>
        <input class="g5q-input" type="text" autocomplete="off" spellcheck="false" placeholder="输入答案">
        <div class="g5q-feedback"><div>参考答案：<span class="g5q-answer">${esc(q.answer)}</span></div>${q.explanation ? `<div class="g5q-muted">${esc(q.explanation)}</div>` : ''}</div>
      </article>`;
    }
    return `<article class="g5q-card" data-qid="${esc(q.id)}" data-type="writing">
      <div class="g5q-num">第 ${index + 1} 题 · 写作（自评，不计入客观题分数）</div>
      <p class="g5q-prompt">${esc(q.prompt)}</p>
      <textarea class="g5q-writing" placeholder="在这里完成写作练习…"></textarea>
      <div class="g5q-feedback">
        <strong>自评清单</strong>
        <ul class="g5q-checklist">${(q.checklist || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <p><strong>参考表达：</strong></p>
        <div class="g5q-sample">${esc(q.sample || '')}</div>
      </div>
    </article>`;
  }

  function activeQuestions() {
    if (!unitQuiz) return [];
    const all = unitQuiz.questions || [];
    if (mode !== 'wrong') return all;
    const wrong = getWrongSet();
    return all.filter((q) => q.type === 'writing' || wrong.has(q.id));
  }

  function previousResultText() {
    try {
      const r = JSON.parse(localStorage.getItem(resultKey()) || 'null');
      if (!r) return '';
      return `上次客观题：${r.correct}/${r.total}（${Math.round((r.correct / Math.max(r.total,1))*100)}%）`;
    } catch (_) { return ''; }
  }

  function render() {
    const root = document.getElementById('grade5QuizRoot');
    if (!root || !unitQuiz) return;
    const questions = activeQuestions();
    const wrongCount = getWrongSet().size;
    const previous = previousResultText();
    const objectiveCount = questions.filter((q) => q.type !== 'writing').length;
    if (mode === 'wrong' && objectiveCount === 0) {
      root.innerHTML = `<div class="g5q-head"><div><h2>${esc(unitQuiz.title)} · 随堂练习</h2><p class="g5q-muted">当前没有错题。</p></div><div class="g5q-actions"><button class="btn" id="g5qAll">练习全部</button></div></div>`;
      document.getElementById('g5qAll')?.addEventListener('click', () => { mode='all'; render(); });
      return;
    }
    let lastSection = '';
    const body = questions.map((q, i) => {
      const heading = q.section !== lastSection ? `<h3 class="g5q-section-title">${esc(q.section)}</h3>` : '';
      lastSection = q.section;
      return heading + renderQuestion(q, i);
    }).join('');
    root.innerHTML = `
      <div class="g5q-head">
        <div>
          <h2>${esc(unitQuiz.title)} · 随堂练习</h2>
          <p class="g5q-muted">${mode === 'wrong' ? `错题专项 · ${objectiveCount} 道客观题` : `共 ${unitQuiz.questions.length} 题，其中 ${unitQuiz.scoredQuestions} 道自动评分 + 1 道写作自评。`}</p>
        </div>
        <div class="g5q-actions">
          <button class="btn" id="g5qAll">全部练习</button>
          <button class="btn" id="g5qWrong">只练错题${wrongCount ? ` (${wrongCount})` : ''}</button>
        </div>
      </div>
      <div class="g5q-summary">${previous || '还没有本单元练习记录。'}<br><span class="g5q-muted">提交后会自动保存错题；答对后会从错题本中移除。</span></div>
      <div id="g5qQuestions">${body}</div>
      <div class="g5q-submit">
        <button class="btn" id="g5qSubmit">提交并判分</button>
        <span id="g5qResult" class="g5q-result"></span>
      </div>`;
    document.getElementById('g5qAll')?.addEventListener('click', () => { mode='all'; render(); });
    document.getElementById('g5qWrong')?.addEventListener('click', () => { mode='wrong'; render(); });
    document.getElementById('g5qSubmit')?.addEventListener('click', grade);
  }

  function grade() {
    const questions = activeQuestions();
    const wrong = getWrongSet();
    let correct = 0;
    let total = 0;
    for (const q of questions) {
      const card = document.querySelector(`.g5q-card[data-qid="${CSS.escape(q.id)}"]`);
      if (!card) continue;
      card.classList.remove('correct','wrong','reviewed');
      if (q.type === 'writing') {
        card.classList.add('reviewed');
        continue;
      }
      total += 1;
      if (isCorrect(q, card)) {
        correct += 1;
        wrong.delete(q.id);
        card.classList.add('correct');
      } else {
        wrong.add(q.id);
        card.classList.add('wrong');
      }
    }
    saveWrongSet(wrong);
    localStorage.setItem(resultKey(), JSON.stringify({ correct, total, at: Date.now() }));
    const pct = Math.round((correct / Math.max(total, 1)) * 100);
    const result = document.getElementById('g5qResult');
    if (result) result.textContent = `客观题 ${correct}/${total} · ${pct}% · 当前错题 ${wrong.size}`;
    document.getElementById('g5qWrong').textContent = `只练错题${wrong.size ? ` (${wrong.size})` : ''}`;
    document.querySelector('.g5q-card.wrong')?.scrollIntoView({behavior:'smooth', block:'center'});
  }

  async function init() {
    const id = unitId();
    const root = document.getElementById('grade5QuizRoot');
    if (!root) return;
    if (!/^unit-\d+$/.test(id)) {
      root.innerHTML = '<p class="g5q-muted">Starter 暂不设置随堂练习，请进入 Unit 1–10。</p>';
      return;
    }
    try {
      const res = await fetch(DATA_URL, {cache:'no-store'});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      unitQuiz = data.units?.[id];
      if (!unitQuiz) throw new Error('找不到本单元题库');
      addStyles();
      render();
    } catch (err) {
      root.innerHTML = `<p class="grade5-note">练习题库加载失败：${esc(err.message)}</p>`;
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();