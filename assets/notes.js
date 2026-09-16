(() => {
  let initialized = false;
  let container = null;
  let searchInput = null;

  function clearHighlights(root) {
    root.querySelectorAll('mark.nce-search-mark').forEach((m) => {
      const p = m.parentNode;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
    });
    root.normalize();
  }

  function highlightText(root, query) {
    clearHighlights(root);
    const q = query.trim().toLowerCase();
    if (!q) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.nodeValue || '';
      const idx = text.toLowerCase().indexOf(q);
      if (idx < 0) continue;
      const frag = document.createDocumentFragment();
      if (idx) frag.appendChild(document.createTextNode(text.slice(0, idx)));
      const mark = document.createElement('mark');
      mark.className = 'nce-search-mark';
      mark.textContent = text.slice(idx, idx + q.length);
      frag.appendChild(mark);
      if (idx + q.length < text.length) frag.appendChild(document.createTextNode(text.slice(idx + q.length)));
      node.parentNode.replaceChild(frag, node);
    }
    root.querySelector('mark.nce-search-mark')?.scrollIntoView({ behavior:'smooth', block:'center' });
  }

  function enhanceExercises(root) {
    root.querySelectorAll('li[x-data]').forEach((li) => {
      li.classList.add('nce-exercise'); li.removeAttribute('x-data');
      let correct = null;
      li.querySelectorAll('div').forEach((div) => {
        if (!div.hasAttribute(':class')) return;
        const expr = div.getAttribute(':class') || '';
        div.removeAttribute(':class'); div.classList.add('nce-option');
        if (/show\s*&&/.test(expr)) correct = div;
      });
      const info = li.querySelector('span[data-bs-toggle="tooltip"][title]');
      const explain = info?.getAttribute('title') || '';
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'nce-answer-btn'; btn.textContent = '看答案'; li.appendChild(btn);
      const reveal = (e) => {
        e?.stopPropagation();
        if (li.classList.contains('revealed')) return;
        li.classList.add('revealed'); correct?.classList.add('nce-correct');
        if (explain) { const box = document.createElement('div'); box.className = 'nce-explain'; box.textContent = explain; li.appendChild(box); }
        btn.textContent = '已显示答案'; btn.disabled = true;
      };
      btn.addEventListener('click', reveal); li.addEventListener('click', reveal);
    });
  }

  async function init() {
    if (initialized) return;
    initialized = true;
    container = document.getElementById('notesContent');
    searchInput = document.getElementById('notesSearch');
    const loading = document.getElementById('notesLoading');
    const down = document.getElementById('notesFontDown');
    const up = document.getElementById('notesFontUp');

    try {
      const { lesson } = await window.NCE_COMMON.getCurrentContext();
      if (!lesson.notes) throw new Error('本内容没有独立学习笔记');
      const res = await fetch(lesson.notes, { cache:'no-store' });
      if (!res.ok) throw new Error(`notes load failed (${res.status})`);
      container.innerHTML = await res.text();
      container.querySelectorAll('*').forEach((el) => {
        const v = el.getAttribute(':style');
        if (v && /blur|opacity/i.test(v)) el.removeAttribute(':style');
      });
      enhanceExercises(container);
      loading.hidden = true; container.hidden = false;
    } catch (err) {
      loading.textContent = '笔记：' + err.message;
    }

    let fontScale = 100;
    const apply = () => { if (container) container.style.fontSize = fontScale + '%'; };
    down?.addEventListener('click', () => { fontScale = Math.max(80, fontScale - 10); apply(); });
    up?.addEventListener('click', () => { fontScale = Math.min(160, fontScale + 10); apply(); });
    searchInput?.addEventListener('input', () => highlightText(container, searchInput.value));
  }

  window.NCE_NOTES = { init };
})();
