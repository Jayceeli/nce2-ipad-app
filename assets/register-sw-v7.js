(() => {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js?v=7', { updateViaCache: 'none' })
      .catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
  });
})();
