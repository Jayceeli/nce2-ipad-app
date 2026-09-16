(() => {
  let catalogPromise = null;
  const bookPromises = new Map();
  const lessonPromises = new Map();

  async function fetchJson(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${url} load failed (${r.status})`);
    return r.json();
  }

  function canonicalBookId(id) {
    if (!id) return '';
    if (id === 'NCE2') return 'nce2';
    return id;
  }

  function parseHash() {
    const raw = decodeURIComponent(location.hash.slice(1));
    const [rawBook, ...rest] = raw.split('/');
    return { book: canonicalBookId(rawBook), rawBook, lessonRef: rest.join('/'), base: rest.join('/') };
  }

  function getBookIdFromQuery() {
    return canonicalBookId(new URLSearchParams(location.search).get('book') || '');
  }

  async function getCatalog() {
    if (!catalogPromise) catalogPromise = fetchJson('data/books.json');
    return catalogPromise;
  }

  async function getBook(bookId) {
    const id = canonicalBookId(bookId);
    if (!id) throw new Error('book id is required');
    if (!bookPromises.has(id)) {
      bookPromises.set(id, (async () => {
        const catalog = await getCatalog();
        const entry = catalog.books.find((b) => b.id === id || b.legacyHash === bookId);
        if (!entry) throw new Error('book not found: ' + id);
        const config = await fetchJson(entry.config);
        return { ...config, catalogEntry: entry, configPath: entry.config };
      })());
    }
    return bookPromises.get(id);
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function pad3(n) { return String(n).padStart(3, '0'); }

  function fillTemplate(pattern, values) {
    return String(pattern || '').replace(/\{([^}]+)\}/g, (_, key) => values[key] ?? '');
  }

  function legacyUnit(book, numericId) {
    return (book.units || []).find((u) => {
      const range = u.lessonRange || [];
      return range.length === 2 && numericId >= range[0] && numericId <= range[1];
    }) || null;
  }

  function normalizeLegacyLessons(book, raw) {
    const legacy = book.legacy || {};
    return raw.map((row) => {
      const unit = legacyUnit(book, Number(row.id));
      const values = {
        id: row.id,
        id2: pad2(row.id),
        id3: pad3(row.id),
        filename: row.filename,
      };
      return {
        id: `${book.id}-l${pad3(row.id)}`,
        order: Number(row.id),
        legacyId: row.filename,
        filename: row.filename,
        title: row.title,
        section: 'Lesson',
        unit: unit?.order || null,
        unitId: unit?.id || null,
        unitTitle: unit?.title || '',
        audio: fillTemplate(legacy.audioPattern, values),
        transcript: fillTemplate(legacy.transcriptPattern, values),
        notes: fillTemplate(legacy.notesPattern, values),
        wordsSource: book.words,
        wordsKey: fillTemplate(legacy.wordsKey || '{id}', values),
        translationStatus: book.translationStatus || 'provided',
        pointReading: true,
      };
    });
  }

  async function getLessons(bookId) {
    const id = canonicalBookId(bookId);
    if (!lessonPromises.has(id)) {
      lessonPromises.set(id, (async () => {
        const book = await getBook(id);
        const raw = await fetchJson(book.lessonData);
        const lessons = book.legacy ? normalizeLegacyLessons(book, raw) : raw.map((x) => ({ ...x }));
        lessons.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        return lessons;
      })());
    }
    return lessonPromises.get(id);
  }

  async function getCurrentContext() {
    const parsed = parseHash();
    if (!parsed.book || !parsed.lessonRef) throw new Error('lesson hash missing');
    const [book, lessons] = await Promise.all([getBook(parsed.book), getLessons(parsed.book)]);
    const lesson = lessons.find((l) => l.id === parsed.lessonRef || l.legacyId === parsed.lessonRef || l.filename === parsed.lessonRef);
    if (!lesson) throw new Error('lesson not found: ' + parsed.lessonRef);
    return { book, lessons, lesson, parsed };
  }

  async function getCurrentLesson() {
    return (await getCurrentContext()).lesson;
  }

  function buildLessonHref(bookId, lesson) {
    return `lesson.html#${canonicalBookId(bookId)}/${encodeURIComponent(lesson.id)}`;
  }

  async function getNeighbors(bookId, lessonId) {
    const lessons = await getLessons(bookId);
    const i = lessons.findIndex((l) => l.id === lessonId || l.legacyId === lessonId || l.filename === lessonId);
    return {
      prev: i > 0 ? lessons[i - 1] : null,
      next: i >= 0 && i + 1 < lessons.length ? lessons[i + 1] : null,
      index: i,
      lessons,
    };
  }

  function getUnit(book, lesson) {
    return (book.units || []).find((u) => u.id === lesson.unitId || u.order === lesson.unit) || null;
  }

  window.NCE_COMMON = {
    fetchJson,
    canonicalBookId,
    parseHash,
    getBookIdFromQuery,
    getCatalog,
    getBook,
    getLessons,
    getCurrentContext,
    getCurrentLesson,
    getNeighbors,
    getUnit,
    buildLessonHref,
    pad2,
    pad3,
  };
})();
