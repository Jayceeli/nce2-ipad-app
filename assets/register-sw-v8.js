(() => {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js?v=8', { updateViaCache: 'none' })
      .catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
  });
})();
