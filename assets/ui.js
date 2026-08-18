(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('[data-view]');
    const views = {
      point: document.getElementById('view-point'),
      notes: document.getElementById('view-notes'),
      dictation: document.getElementById('view-dictation'),
    };

    function activate(view) {
      tabs.forEach((t) => t.classList.toggle('active', t.dataset.view === view));
      Object.entries(views).forEach(([key, el]) => {
        if (el) el.hidden = key !== view;
      });
      if (view === 'notes') window.NCE_NOTES?.init();
      if (view === 'dictation') window.NCE_DICTATION?.init();
      window.scrollTo(0, 0);
    }

    tabs.forEach((t) => t.addEventListener('click', () => activate(t.dataset.view)));
    activate('point');
  });
})();
