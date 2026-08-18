(() => {
  let initialized = false;
  let lessonId = null;
  let container = null;
  let searchInput = null;
  let originalHtml = '';

  function clearHighlights(root) {
    root.querySelectorAll('mark.nce-search-mark').forEach((m) => {
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
    });
    root.normalize();
  }

  function highlightText(root, query) {
    clearHighlights(root);
    const q = query.trim();
    if (!q) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (node.parentElement.closest('mark.nce-search-mark')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.nodeValue;
      const lower = text.toLowerCase();
      const idx = lower.indexOf(q.toLowerCase());
      if (idx === -1) continue;
      const before = text.slice(0, idx);
      const match = text.slice(idx, idx + q.length);
      const after = text.slice(idx + q.length);
      const frag = document.createDocumentFragment();
      if (before) frag.appendChild(document.createTextNode(before));
      const mark = document.createElement('mark');
      mark.className = 'nce-search-mark';
      mark.textContent = match;
      frag.appendChild(mark);
      if (after) frag.appendChild(document.createTextNode(after));
      node.parentNode.replaceChild(frag, node);
    }
    const firstMark = root.querySelector('mark.nce-search-mark');
    if (firstMark) firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function revealExercise(li, correctOption, explain, btn) {
    if (li.classList.contains('revealed')) return;
    li.classList.add('revealed');
    if (correctOption) correctOption.classList.add('nce-correct');
    if (explain) {
      const box = document.createElement('div');
      box.className = 'nce-explain';
      box.textContent = explain;
      li.appendChild(box);
    }
    if (btn) {
      btn.textContent = '已显示答案';
      btn.disabled = true;
    }
  }

  function enhanceExercises(root) {
    root.querySelectorAll('li[x-data]').forEach((li) => {
      li.classList.add('nce-exercise');
      li.removeAttribute('x-data');

      let correctOption = null;
      li.querySelectorAll('div').forEach((div) => {
        if (!div.hasAttribute(':class')) return;
        const expr = div.getAttribute(':class') || '';
        div.removeAttribute(':class');
        div.classList.add('nce-option');
        if (/show\s*&&\s*['"][^'"]+['"]/.test(expr)) correctOption = div;
      });

      const info = li.querySelector('span[data-bs-toggle="tooltip"][title]');
      const explain = info ? (info.getAttribute('title') || '').trim() : '';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nce-answer-btn';
      btn.textContent = '看答案';
      li.appendChild(btn);

      const reveal = (e) => {
        if (e) e.stopPropagation();
        revealExercise(li, correctOption, explain, btn);
      };
      btn.addEventListener('click', reveal);
      li.addEventListener('click', reveal);
    });
  }

  async function init() {
    if (initialized) return;
    initialized = true;
    container = document.getElementById('notesContent');
    searchInput = document.getElementById('notesSearch');
    const fontDown = document.getElementById('notesFontDown');
    const fontUp = document.getElementById('notesFontUp');
    const loading = document.getElementById('notesLoading');

    try {
      const lesson = await window.NCE_COMMON.getCurrentLesson();
      lessonId = lesson.id;
      const res = await fetch(`notes/lesson-${window.NCE_COMMON.pad2(lessonId)}.html`);
      if (!res.ok) throw new Error('notes load failed');
      originalHtml = await res.text();
      container.innerHTML = originalHtml;
      enhanceExercises(container);
      loading.hidden = true;
      container.hidden = false;
    } catch (err) {
      loading.textContent = '笔记加载失败：' + err.message;
    }

    let fontScale = 100;
    function applyFontScale() {
      container.style.fontSize = fontScale + '%';
    }
    if (fontDown) fontDown.addEventListener('click', () => { fontScale = Math.max(80, fontScale - 10); applyFontScale(); });
    if (fontUp) fontUp.addEventListener('click', () => { fontScale = Math.min(150, fontScale + 10); applyFontScale(); });

    if (searchInput) {
      searchInput.addEventListener('input', () => highlightText(container, searchInput.value));
    }
  }

  window.NCE_NOTES = { init };
})();
