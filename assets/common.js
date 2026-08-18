(() => {
  let lessonsPromise = null;

  function parseHash() {
    const raw = decodeURIComponent(location.hash.slice(1));
    const [book, ...rest] = raw.split('/');
    return { book, base: rest.join('/') };
  }

  async function getLessons() {
    if (!lessonsPromise) {
      lessonsPromise = fetch('data/lessons.json').then((r) => {
        if (!r.ok) throw new Error('lessons.json load failed');
        return r.json();
      });
    }
    return lessonsPromise;
  }

  async function getCurrentLesson() {
    const lessons = await getLessons();
    const { base } = parseHash();
    const lesson = lessons.find((l) => l.filename === base);
    if (!lesson) throw new Error('lesson not found: ' + base);
    return lesson;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  window.NCE_COMMON = { parseHash, getLessons, getCurrentLesson, pad2 };
})();
