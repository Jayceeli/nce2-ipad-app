(() => {
  function $(id) { return document.getElementById(id); }

  function statusFor(bookId, lesson) {
    const p = window.progressManager?.getLessonProgress(bookId, lesson.id)
      || (lesson.legacyId ? window.progressManager?.getLessonProgress('NCE2', lesson.legacyId) : null);
    if (p?.completed) return { text: '已完成', cls: 'completed' };
    if (p?.lastVisit) return { text: '进行中', cls: 'in-progress' };
    return { text: '未学', cls: '' };
  }

  function renderBookPicker(catalog) {
    $('pageTitle').textContent = catalog.app.title;
    $('pageSubtitle').textContent = catalog.app.subtitle;
    $('bookBack').hidden = true;
    $('stats').style.display = 'none';
    const root = $('lessons');
    root.innerHTML = '<div class="book-grid"></div>';
    const grid = root.firstElementChild;
    catalog.books.forEach((book) => {
      const a = document.createElement('a');
      a.className = 'lesson-item book-item';
      a.href = `index.html?book=${encodeURIComponent(book.id)}`;
      a.innerHTML = `
        <span class="lesson-card-num">${book.id === 'nce2' ? 'N2' : '5A'}</span>
        <div class="lesson-info">
          <div class="lesson-title">${book.title}</div>
          <div class="muted">${book.englishTitle || ''}</div>
          <span class="lesson-status-pill">${book.description || '进入教材'}</span>
        </div>
        <span class="lesson-arrow">›</span>`;
      grid.appendChild(a);
    });
  }

  function renderStats(book, lessons) {
    if (!window.progressManager) return;
    const progress = window.progressManager.getBookProgress(book.id);
    const legacy = book.id === 'nce2' ? window.progressManager.getBookProgress('NCE2') : [];
    const seen = new Map([...legacy, ...progress].map((p) => [p.lessonId, p]));
    const completed = [...seen.values()].filter((p) => p.completed).length;
    const duration = [...seen.values()].reduce((sum, p) => sum + (p.totalTime || 0), 0);
    const stats = window.progressManager.getStatistics();
    const el = $('stats');
    el.style.display = 'block';
    el.innerHTML = `
      <div class="stats-grid">
        <div class="stat-item"><div class="stat-value">${completed}</div><div class="stat-label">已完成内容</div></div>
        <div class="stat-item"><div class="stat-value">${window.progressManager.formatDuration(duration)}</div><div class="stat-label">本教材学习时长</div></div>
        <div class="stat-item"><div class="stat-value">${stats.streak || 0}</div><div class="stat-label">连续天数</div></div>
      </div>`;
  }

  async function renderBook(bookId) {
    const [book, lessons] = await Promise.all([
      window.NCE_COMMON.getBook(bookId),
      window.NCE_COMMON.getLessons(bookId),
    ]);
    document.title = `${book.shortTitle || book.title} · 英语点读学习`;
    $('pageTitle').textContent = book.shortTitle || book.title;
    $('pageSubtitle').textContent = book.subtitle || '';
    $('bookBack').hidden = false;
    $('bookBack').href = 'index.html';
    $('settingsLink').href = `settings.html?book=${encodeURIComponent(book.id)}`;
    renderStats(book, lessons);

    const root = $('lessons');
    root.innerHTML = '';
    const units = book.units || [];
    for (const unit of units) {
      const unitLessons = lessons.filter((l) => l.unitId === unit.id || l.unit === unit.order);
      const h = document.createElement('div');
      h.className = 'unit-header';
      const pageText = unit.printedPages ? ` · 教材 ${unit.printedPages[0]}–${unit.printedPages[1]} 页` : '';
      h.textContent = `${unit.title}${pageText}`;
      root.appendChild(h);
      if (!unitLessons.length) {
        const pending = document.createElement('div');
        pending.className = 'page-card muted pending-unit';
        pending.textContent = unit.status === 'pending' ? '整本教材生成阶段将在样板验证后批量加入。' : '暂无内容。';
        root.appendChild(pending);
        continue;
      }
      unitLessons.forEach((lesson) => {
        const state = statusFor(book.id, lesson);
        const a = document.createElement('a');
        a.className = `lesson-item ${state.cls}`.trim();
        a.href = window.NCE_COMMON.buildLessonHref(book.id, lesson);
        const num = book.id === 'nce2' ? String(lesson.order) : String(lesson.order).padStart(2, '0');
        a.innerHTML = `
          <span class="lesson-card-num">${num}</span>
          <div class="lesson-info">
            <div class="lesson-title">${lesson.title}</div>
            <div class="muted">${lesson.section || ''}${lesson.page ? ` · p.${lesson.page}` : ''}</div>
            <span class="lesson-status-pill">${state.text}</span>
          </div>
          <span class="lesson-arrow">›</span>`;
        root.appendChild(a);
      });
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const loading = $('loading');
    try {
      const catalog = await window.NCE_COMMON.getCatalog();
      const bookId = window.NCE_COMMON.getBookIdFromQuery();
      if (!bookId) renderBookPicker(catalog);
      else await renderBook(bookId);
      loading.hidden = true;
    } catch (err) {
      loading.textContent = '目录加载失败：' + err.message;
    }
  });
})();
