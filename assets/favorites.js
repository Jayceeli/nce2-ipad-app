/**
 * 收藏管理系统
 * 负责管理句子收藏和生词本功能
 */

class FavoritesManager {
  constructor() {
    this.STORAGE_KEY = 'nce_favorites';
    this.VOCABULARY_KEY = 'nce_vocabulary';
  }

  // 获取所有收藏的句子
  getFavorites() {
    const data = localStorage.getItem(this.STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  }

  // 检查句子是否已收藏
  isFavorite(book, lessonId, sentenceIndex) {
    const favorites = this.getFavorites();
    return favorites.some(f => 
      f.book === book && 
      f.lessonId === lessonId && 
      f.sentenceIndex === sentenceIndex
    );
  }

  // 添加收藏
  addFavorite(book, lessonId, sentenceIndex, sentenceData) {
    const favorites = this.getFavorites();
    
    // 避免重复添加
    if(this.isFavorite(book, lessonId, sentenceIndex)) {
      return false;
    }
    
    favorites.push({
      book,
      lessonId,
      sentenceIndex,
      en: sentenceData.en,
      cn: sentenceData.cn || '',
      timestamp: Date.now()
    });
    
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(favorites));
    return true;
  }

  // 移除收藏
  removeFavorite(book, lessonId, sentenceIndex) {
    const favorites = this.getFavorites();
    const filtered = favorites.filter(f => 
      !(f.book === book && 
        f.lessonId === lessonId && 
        f.sentenceIndex === sentenceIndex)
    );
    
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(filtered));
    return filtered.length < favorites.length;
  }

  // 切换收藏状态
  toggleFavorite(book, lessonId, sentenceIndex, sentenceData) {
    if(this.isFavorite(book, lessonId, sentenceIndex)) {
      this.removeFavorite(book, lessonId, sentenceIndex);
      return false;
    } else {
      this.addFavorite(book, lessonId, sentenceIndex, sentenceData);
      return true;
    }
  }

  // 获取收藏统计
  getStatistics() {
    const favorites = this.getFavorites();
    const bookStats = {};
    
    favorites.forEach(f => {
      if(!bookStats[f.book]) {
        bookStats[f.book] = 0;
      }
      bookStats[f.book]++;
    });
    
    return {
      total: favorites.length,
      byBook: bookStats,
      recent: favorites.slice(-10).reverse()
    };
  }

  // 生词本功能
  
  // 获取所有生词
  getVocabulary() {
    const data = localStorage.getItem(this.VOCABULARY_KEY);
    return data ? JSON.parse(data) : [];
  }

  // 添加生词
  addWord(word, context = {}) {
    const vocabulary = this.getVocabulary();
    
    // 避免重复
    if(vocabulary.some(v => v.word.toLowerCase() === word.toLowerCase())) {
      return false;
    }
    
    vocabulary.push({
      word,
      context: context.sentence || '',
      translation: context.translation || '',
      notes: context.notes || '',
      book: context.book || '',
      lessonId: context.lessonId || '',
      timestamp: Date.now(),
      reviewCount: 0,
      lastReview: null
    });
    
    localStorage.setItem(this.VOCABULARY_KEY, JSON.stringify(vocabulary));
    return true;
  }

  // 移除生词
  removeWord(word) {
    const vocabulary = this.getVocabulary();
    const filtered = vocabulary.filter(v => 
      v.word.toLowerCase() !== word.toLowerCase()
    );
    
    localStorage.setItem(this.VOCABULARY_KEY, JSON.stringify(filtered));
    return filtered.length < vocabulary.length;
  }

  // 更新生词复习记录
  markWordReviewed(word) {
    const vocabulary = this.getVocabulary();
    const wordItem = vocabulary.find(v => 
      v.word.toLowerCase() === word.toLowerCase()
    );
    
    if(wordItem) {
      wordItem.reviewCount++;
      wordItem.lastReview = Date.now();
      localStorage.setItem(this.VOCABULARY_KEY, JSON.stringify(vocabulary));
      return true;
    }
    
    return false;
  }

  // 获取需要复习的生词
  getWordsForReview(limit = 20) {
    const vocabulary = this.getVocabulary();
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    
    // 根据复习次数和时间间隔排序
    return vocabulary
      .filter(w => {
        if(!w.lastReview) return true;
        const daysSinceReview = (now - w.lastReview) / dayMs;
        // 根据复习次数决定复习间隔
        const interval = Math.pow(2, w.reviewCount); // 1, 2, 4, 8... 天
        return daysSinceReview >= interval;
      })
      .sort((a, b) => {
        // 优先显示从未复习的词
        if(!a.lastReview) return -1;
        if(!b.lastReview) return 1;
        // 然后按最后复习时间排序
        return a.lastReview - b.lastReview;
      })
      .slice(0, limit);
  }

  // 导出收藏和生词数据
  exportData() {
    return {
      favorites: this.getFavorites(),
      vocabulary: this.getVocabulary(),
      exportDate: new Date().toISOString()
    };
  }

  // 导入数据
  importData(data) {
    if(data.favorites) {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data.favorites));
    }
    if(data.vocabulary) {
      localStorage.setItem(this.VOCABULARY_KEY, JSON.stringify(data.vocabulary));
    }
    return true;
  }
}

// 创建全局实例
window.favoritesManager = new FavoritesManager();
