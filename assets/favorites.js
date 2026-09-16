/** Book-aware favorites and vocabulary store. */
class FavoritesManager {
  constructor() {
    this.KEY = 'learning_favorites_v2';
    this.VOCAB_KEY = 'learning_vocabulary_v2';
    this.LEGACY_KEY = 'nce_favorites';
    this.LEGACY_VOCAB = 'nce_vocabulary';
  }

  getFavorites() {
    let current = [];
    try { current = JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch (_) {}
    let legacy = [];
    try { legacy = JSON.parse(localStorage.getItem(this.LEGACY_KEY) || '[]'); } catch (_) {}
    const converted = legacy.map((f) => ({
      bookId: f.book === 'NCE2' ? 'nce2' : (f.book || ''),
      unitId: f.unitId || '', lessonId: f.lessonId, sentenceId: String(f.sentenceIndex), sentenceIndex:f.sentenceIndex,
      en:f.en || '', cn:f.cn || '', start:f.start ?? null, end:f.end ?? null, timestamp:f.timestamp || 0, legacy:true,
    }));
    const map = new Map();
    [...converted, ...current].forEach((f) => map.set(`${f.bookId}|${f.lessonId}|${f.sentenceId ?? f.sentenceIndex}`, f));
    return [...map.values()];
  }

  isFavorite(bookId, lessonId, sentenceIndex) {
    return this.getFavorites().some((f) => f.bookId === bookId && f.lessonId === lessonId && Number(f.sentenceIndex ?? f.sentenceId) === Number(sentenceIndex));
  }

  addFavorite(bookId, lessonId, sentenceIndex, data = {}) {
    if (this.isFavorite(bookId, lessonId, sentenceIndex)) return false;
    const list = this.getFavorites().filter((x) => !x.legacy);
    list.push({
      bookId, unitId:data.unitId || '', unitTitle:data.unitTitle || '', lessonId, lessonTitle:data.lessonTitle || '',
      sentenceId:String(sentenceIndex), sentenceIndex:Number(sentenceIndex), en:data.en || '', cn:data.cn || '',
      start:Number.isFinite(data.start) ? data.start : null, end:Number.isFinite(data.end) ? data.end : null,
      timestamp:Date.now(),
    });
    localStorage.setItem(this.KEY, JSON.stringify(list));
    return true;
  }

  removeFavorite(bookId, lessonId, sentenceIndex) {
    const before = this.getFavorites().filter((x) => !x.legacy);
    const after = before.filter((f) => !(f.bookId === bookId && f.lessonId === lessonId && Number(f.sentenceIndex) === Number(sentenceIndex)));
    localStorage.setItem(this.KEY, JSON.stringify(after));
    return after.length < before.length || this.isFavorite(bookId, lessonId, sentenceIndex);
  }

  toggleFavorite(bookId, lessonId, sentenceIndex, data = {}) {
    if (this.isFavorite(bookId, lessonId, sentenceIndex)) {
      const all = this.getFavorites();
      const kept = all.filter((f) => !(f.bookId === bookId && f.lessonId === lessonId && Number(f.sentenceIndex ?? f.sentenceId) === Number(sentenceIndex)) && !f.legacy);
      localStorage.setItem(this.KEY, JSON.stringify(kept));
      return false;
    }
    this.addFavorite(bookId, lessonId, sentenceIndex, data); return true;
  }

  getStatistics() {
    const list = this.getFavorites(); const byBook = {};
    list.forEach((f) => { byBook[f.bookId] = (byBook[f.bookId] || 0) + 1; });
    return { total:list.length, byBook, recent:list.slice().sort((a,b)=>(b.timestamp||0)-(a.timestamp||0)).slice(0,10) };
  }

  getVocabulary() {
    let a = [], b = [];
    try { a = JSON.parse(localStorage.getItem(this.VOCAB_KEY) || '[]'); } catch (_) {}
    try { b = JSON.parse(localStorage.getItem(this.LEGACY_VOCAB) || '[]'); } catch (_) {}
    return [...b.map((x) => ({...x, bookId:x.book === 'NCE2' ? 'nce2' : (x.book || ''), legacy:true})), ...a];
  }

  addWord(word, context = {}) {
    const all = this.getVocabulary();
    if (all.some((v) => v.word.toLowerCase() === word.toLowerCase() && (v.bookId || '') === (context.bookId || context.book || ''))) return false;
    const current = all.filter((x) => !x.legacy);
    current.push({ word, context:context.sentence || '', translation:context.translation || '', notes:context.notes || '',
      bookId:context.bookId || context.book || '', unitId:context.unitId || '', lessonId:context.lessonId || '', timestamp:Date.now(), reviewCount:0, lastReview:null });
    localStorage.setItem(this.VOCAB_KEY, JSON.stringify(current)); return true;
  }

  removeWord(word, bookId = '') {
    const current = this.getVocabulary().filter((x) => !x.legacy);
    const after = current.filter((v) => !(v.word.toLowerCase() === word.toLowerCase() && (!bookId || v.bookId === bookId)));
    localStorage.setItem(this.VOCAB_KEY, JSON.stringify(after)); return after.length < current.length;
  }

  markWordReviewed(word, bookId = '') {
    const current = this.getVocabulary().filter((x) => !x.legacy);
    const item = current.find((v) => v.word.toLowerCase() === word.toLowerCase() && (!bookId || v.bookId === bookId));
    if (!item) return false;
    item.reviewCount = Number(item.reviewCount || 0) + 1; item.lastReview = Date.now();
    localStorage.setItem(this.VOCAB_KEY, JSON.stringify(current)); return true;
  }

  getWordsForReview(limit = 20) {
    const now = Date.now(), day = 86400000;
    return this.getVocabulary().filter((w) => !w.lastReview || (now - w.lastReview) / day >= Math.pow(2, w.reviewCount || 0))
      .sort((a,b)=>(a.lastReview||0)-(b.lastReview||0)).slice(0, limit);
  }

  exportData() { return { version:'2.0', favorites:this.getFavorites(), vocabulary:this.getVocabulary(), exportDate:new Date().toISOString() }; }
  importData(data) {
    if (data.favorites) localStorage.setItem(this.KEY, JSON.stringify(data.favorites));
    if (data.vocabulary) localStorage.setItem(this.VOCAB_KEY, JSON.stringify(data.vocabulary));
    return true;
  }
}
window.favoritesManager = new FavoritesManager();
