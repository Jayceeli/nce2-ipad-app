(() => {
  const DATA_BASE = 'https://raw.githubusercontent.com/Jayceeli/hujiao-grade5-english/main/';
  const BOOK_ID = 'SHG5A2026';

  document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('grade5Units');
    const loading = document.getElementById('grade5Loading');
    const statsEl = document.getElementById('grade5Stats');

    try {
      const res = await fetch(DATA_BASE + 'data/index.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const catalog = await res.json();
      container.innerHTML = '';

      catalog.units.forEach((unit, index) => {
        if (index === 0 || index === 1) {
          const header = document.createElement('div');
          header.className = 'unit-header';
          header.textContent = index === 0 ? 'Starter' : 'Unit 1–10';
          container.appendChild(header);
        }

        const a = document.createElement('a');
        a.className = 'lesson-item';
        a.href = `grade5-lesson.html#${encodeURIComponent(unit.id)}`;

        let status = '未学';
        const p = window.progressManager?.getLessonProgress(BOOK_ID, unit.id);
        if (p?.completed) {
          a.classList.add('completed');
          status = '已完成';
        } else if (p?.lastVisit) {
          a.classList.add('in-progress');
          status = '进行中';
        }

        const num = unit.id === 'starter' ? 'S' : String(unit.id.split('-')[1] || index);
        a.innerHTML = `
          <span class="lesson-card-num">${num}</span>
          <div class="lesson-info">
            <div>
              <div class="lesson-title">${unit.title}</div>
              <div class="muted">教材 PDF 第 ${unit.pageRange[0]}–${unit.pageRange[1]} 页</div>
            </div>
            <span class="lesson-status-pill">${status}</span>
          </div>
          <span class="lesson-arrow">›</span>
        `;
        container.appendChild(a);
      });

      const rows = window.progressManager?.getBookProgress(BOOK_ID) || [];
      const done = rows.filter(x => x.completed).length;
      const stats = window.progressManager?.getStatistics();
      if (statsEl) {
        statsEl.style.display = 'block';
        statsEl.innerHTML = `
          <div class="stats-grid">
            <div class="stat-item"><div class="stat-value">${done}</div><div class="stat-label">已完成单元</div></div>
            <div class="stat-item"><div class="stat-value">${rows.length}</div><div class="stat-label">已开始单元</div></div>
            <div class="stat-item"><div class="stat-value">${stats ? window.progressManager.formatDuration(stats.total.duration) : '0秒'}</div><div class="stat-label">累计学习时长</div></div>
          </div>
        `;
      }
      loading.hidden = true;
    } catch (err) {
      loading.textContent = '五年级教材数据加载失败：' + err.message;
    }
  });
})();
