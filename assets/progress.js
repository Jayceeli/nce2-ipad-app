/** Book-aware learning progress with NCE2 legacy compatibility. */
class ProgressManager {
  constructor() {
    this.PREFIX = 'learning_progress_';
    this.GLOBAL_STATS = 'learning_statistics_global';
    this.LEGACY_PREFIX = 'nce_progress_';
    this.LEGACY_STATS = 'nce_statistics';
  }

  day(date = new Date()) { return date.toISOString().split('T')[0]; }
  key(book, lessonId) { return `${this.PREFIX}${book}_${lessonId}`; }

  getLessonProgress(book, lessonId) {
    const direct = localStorage.getItem(this.key(book, lessonId));
    if (direct) return JSON.parse(direct);
    if (book === 'NCE2' || book === 'nce2') {
      const legacyBook = book === 'NCE2' ? 'NCE2' : 'nce2';
      const old = localStorage.getItem(`${this.LEGACY_PREFIX}${legacyBook}_${lessonId}`)
        || localStorage.getItem(`${this.LEGACY_PREFIX}NCE2_${lessonId}`);
      if (old) return JSON.parse(old);
    }
    return null;
  }

  saveLessonProgress(book, lessonId, data = {}) {
    const old = this.getLessonProgress(book, lessonId) || {};
    const duration = Number(data.duration || 0);
    const progress = {
      ...old,
      book,
      lessonId,
      firstVisit: old.firstVisit || Date.now(),
      lastVisit: Date.now(),
      totalTime: Number(old.totalTime || 0) + duration,
      completedCount: Number(old.completedCount || 0) + (data.completed && !old.completed ? 1 : 0),
      sentences: data.sentences || old.sentences || {},
      totalSentences: data.totalSentences ?? old.totalSentences ?? 0,
      completed: Boolean(old.completed || data.completed),
      legacyId: data.legacyId ?? old.legacyId ?? null,
    };
    localStorage.setItem(this.key(book, lessonId), JSON.stringify(progress));
    if (duration > 0 || Number(data.sentenceCount || 0) > 0) this.updateStatistics(book, lessonId, data);
    return progress;
  }

  getBookProgress(book) {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(`${this.PREFIX}${book}_`)) {
        try { out.push(JSON.parse(localStorage.getItem(k))); } catch (_) {}
      }
    }
    if (book === 'nce2' || book === 'NCE2') {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(`${this.LEGACY_PREFIX}NCE2_`)) {
          try { out.push(JSON.parse(localStorage.getItem(k))); } catch (_) {}
        }
      }
    }
    return out;
  }

  getStatistics() {
    const raw = localStorage.getItem(this.GLOBAL_STATS) || localStorage.getItem(this.LEGACY_STATS);
    if (raw) {
      try { return JSON.parse(raw); } catch (_) {}
    }
    return { total:{duration:0,lessons:0,days:0,lastStudy:null}, daily:{}, streak:0, byBook:{} };
  }

  updateStatistics(book, lessonId, data = {}) {
    const stats = this.getStatistics();
    stats.daily ||= {}; stats.byBook ||= {}; stats.total ||= {duration:0,lessons:0,days:0,lastStudy:null};
    const today = this.day();
    const daily = stats.daily[today] || { lessons:[], duration:0, sentences:0 };
    if (!daily.lessons.includes(`${book}_${lessonId}`)) daily.lessons.push(`${book}_${lessonId}`);
    daily.duration += Number(data.duration || 0);
    daily.sentences += Number(data.sentenceCount || 0);
    stats.daily[today] = daily;

    const b = stats.byBook[book] || { duration:0, sentences:0, lastStudy:null };
    b.duration += Number(data.duration || 0); b.sentences += Number(data.sentenceCount || 0); b.lastStudy = Date.now();
    stats.byBook[book] = b;
    stats.total.duration = Number(stats.total.duration || 0) + Number(data.duration || 0);
    stats.total.lessons = this.getTotalLessonCount();
    stats.total.days = Object.keys(stats.daily).length;
    stats.total.lastStudy = Date.now();
    stats.streak = this.calculateStreak(stats.daily);
    localStorage.setItem(this.GLOBAL_STATS, JSON.stringify(stats));
    return stats;
  }

  calculateStreak(daily) {
    let streak = 0;
    const today = new Date(); today.setHours(0,0,0,0);
    for (let i = 0; i < 3650; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const key = this.day(d);
      if (daily[key]) streak++;
      else if (i > 0) break;
    }
    return streak;
  }

  getTotalLessonCount() {
    const seen = new Set();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(this.PREFIX) || k?.startsWith(this.LEGACY_PREFIX)) seen.add(k);
    }
    return seen.size;
  }

  markSentenceLearned(book, lessonId, sentenceIndex, duration = 0) {
    const progress = this.getLessonProgress(book, lessonId) || {};
    const sentences = { ...(progress.sentences || {}) };
    const prev = sentences[sentenceIndex] || {};
    sentences[sentenceIndex] = {
      learned:true,
      count:Number(prev.count || 0) + 1,
      lastTime:Date.now(),
      totalDuration:Number(prev.totalDuration || 0) + Number(duration || 0),
    };
    const learned = Object.values(sentences).filter((x) => x.learned).length;
    return this.saveLessonProgress(book, lessonId, {
      sentences,
      totalSentences: progress.totalSentences || 0,
      completed: (progress.totalSentences || 0) > 0 && learned >= progress.totalSentences,
    });
  }

  getHeatmapData(days = 30) {
    const stats = this.getStatistics();
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = this.day(d);
      out.push({ date:key, value:stats.daily?.[key]?.duration || 0, lessons:stats.daily?.[key]?.lessons?.length || 0 });
    }
    return out;
  }

  formatDuration(seconds) {
    seconds = Number(seconds || 0);
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60);
    if (h) return `${h}小时${m}分钟`;
    if (m) return `${m}分钟${s}秒`;
    return `${s}秒`;
  }

  clearAllProgress() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(this.PREFIX) || k?.startsWith(this.LEGACY_PREFIX) || k === this.GLOBAL_STATS || k === this.LEGACY_STATS) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  }

  exportProgress() {
    const storage = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(this.PREFIX) || k?.startsWith(this.LEGACY_PREFIX) || k === this.GLOBAL_STATS || k === this.LEGACY_STATS) storage[k] = localStorage.getItem(k);
    }
    return { version:'2.0', exportDate:new Date().toISOString(), storage };
  }

  importProgress(data) {
    if (data.storage) Object.entries(data.storage).forEach(([k,v]) => localStorage.setItem(k, v));
    else if (data.progress) Object.entries(data.progress).forEach(([k,v]) => localStorage.setItem(k, JSON.stringify(v)));
    if (data.statistics && !data.storage) localStorage.setItem(this.GLOBAL_STATS, JSON.stringify(data.statistics));
    return true;
  }
}
window.progressManager = new ProgressManager();
