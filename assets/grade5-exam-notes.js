(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const unitId = () => decodeURIComponent(location.hash.slice(1) || 'starter');
  const noteUrl = (id) => `data/grade5-exam-notes/${encodeURIComponent(id)}.json`;

  function addStyles() {
    if (document.getElementById('grade5ExamNotesStyle')) return;
    const style = document.createElement('style');
    style.id = 'grade5ExamNotesStyle';
    style.textContent = `
      .grade5-exam-section{margin-top:30px;padding-top:4px}
      .grade5-exam-badge{display:inline-block;padding:3px 9px;border-radius:999px;font-size:12px;font-weight:700;background:rgba(127,127,127,.12);margin-right:7px}
      .grade5-exam-card{margin:10px 0;padding:13px 14px;border:1px solid rgba(127,127,127,.18);border-radius:13px}
      .grade5-exam-card p{margin:6px 0;line-height:1.55}
      .grade5-exam-answer{font-weight:700}
      .grade5-exam-arrow{margin:5px 0;color:var(--muted,#777)}
      .grade5-writing-box{padding:14px;border-radius:14px;background:rgba(127,127,127,.07)}
      .grade5-writing-box ul{margin-bottom:10px}
    `;
    document.head.appendChild(style);
  }

  function render(data) {
    const pronunciation = (data.pronunciation || []).map((x) => `
      <div class="grade5-exam-card">
        <p><span class="grade5-exam-badge">辨音</span><strong>${esc(x.letters)}</strong> · ${esc((x.examples || []).join(' / '))}</p>
        <p class="muted">${esc(x.note)}</p>
      </div>`).join('');

    const wordForms = (data.wordForms || []).map((x) => `
      <div class="grade5-exam-card">
        <p><strong>${esc(x.item)}</strong></p>
        <p>${esc(x.forms)}</p>
        <p class="muted">考试提示：${esc(x.examTip)}</p>
      </div>`).join('');

    const examPoints = (data.examPoints || []).map((x) => `
      <div class="grade5-exam-card">
        <p><span class="grade5-exam-badge">${esc(x.type)}</span><strong>${esc(x.point)}</strong></p>
        <p lang="en">${esc(x.example)}</p>
        <p>答案/要点：<span class="grade5-exam-answer">${esc(x.answer)}</span></p>
      </div>`).join('');

    const transformations = (data.transformations || []).map((x) => `
      <div class="grade5-exam-card">
        <p lang="en">${esc(x.from)}</p>
        <div class="grade5-exam-arrow">↓</div>
        <p lang="en"><strong>${esc(x.to)}</strong></p>
        <p class="muted">${esc(x.point)}</p>
      </div>`).join('');

    const w = data.writing || {};
    const writing = w.topic ? `
      <div class="grade5-writing-box">
        <p><strong>主题：</strong>${esc(w.topic)}</p>
        <p><strong>建议结构：</strong></p>
        <ol>${(w.structure || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
        <p><strong>可直接迁移的教材表达：</strong></p>
        <ul>${(w.useful || []).map((x) => `<li lang="en">${esc(x)}</li>`).join('')}</ul>
      </div>` : '';

    return `
      <div id="grade5ExamReview" class="grade5-exam-section">
        <h3>考试复习重点</h3>
        <p class="muted">从本单元全文、Words to use、Sound/Sounds 与 Project 中提取，重点覆盖学校常见的辨音、词形、填空、选择、句型转换、阅读和写作。</p>
        <h4>语音 / 辨音</h4>${pronunciation || '<p class="muted">本单元暂无单独语音整理。</p>'}
        <h4>词形 · 词性 · 拼写</h4>${wordForms || '<p class="muted">暂无。</p>'}
        <h4>高频题型与考法</h4>${examPoints || '<p class="muted">暂无。</p>'}
        <h4>句型转换 / 同义表达</h4>${transformations || '<p class="muted">暂无。</p>'}
        <h4>单元写作</h4>${writing || '<p class="muted">暂无。</p>'}
      </div>`;
  }

  function insert(data) {
    const root = document.querySelector('#grade5NotesContent .grade5-notes-panel');
    if (!root) return false;
    document.getElementById('grade5ExamReview')?.remove();
    const marker = [...root.querySelectorAll('h3')].find((h) => h.textContent.trim() === '精校正文');
    const holder = document.createElement('div');
    holder.innerHTML = render(data);
    const node = holder.firstElementChild;
    if (marker) root.insertBefore(node, marker);
    else root.appendChild(node);
    return true;
  }

  async function loadCurrent() {
    const id = unitId();
    if (!/^unit-\d+$/.test(id)) return;
    try {
      const res = await fetch(noteUrl(id), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      addStyles();
      for (let i = 0; i < 50; i++) {
        if (insert(data)) return;
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch (err) {
      console.warn('Grade 5 exam notes failed:', err);
    }
  }

  function warmExamNotesCache() {
    for (let i = 1; i <= 10; i++) {
      fetch(noteUrl(`unit-${i}`)).catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadCurrent();
    warmExamNotesCache();
  });
})();