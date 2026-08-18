/**
 * 学习进度管理系统
 * 负责记录、存储和分析用户的学习数据
 */

class ProgressManager {
  constructor() {
    this.STORAGE_PREFIX = 'nce_progress_';
    this.STATS_KEY = 'nce_statistics';
    this.TODAY = this.getDateString(new Date());
  }

  // 获取日期字符串 YYYY-MM-DD
  getDateString(date) {
    return date.toISOString().split('T')[0];
  }

  // 记录课程学习进度
  saveLessonProgress(book, lessonId, data = {}) {
    const key = `${this.STORAGE_PREFIX}${book}_${lessonId}`;
    const existing = this.getLessonProgress(book, lessonId);
    
    const progress = {
      book,
      lessonId,
      firstVisit: existing?.firstVisit || Date.now(),
      lastVisit: Date.now(),
      completedCount: (existing?.completedCount || 0) + (data.completed ? 1 : 0),
      totalTime: (existing?.totalTime || 0) + (data.duration || 0),
      sentences: data.sentences || existing?.sentences || {},
      completed: data.completed || existing?.completed || false,
      ...data
    };
    
    localStorage.setItem(key, JSON.stringify(progress));
    this.updateStatistics(book, lessonId, data);
    return progress;
  }

  // 获取课程进度
  getLessonProgress(book, lessonId) {
    const key = `${this.STORAGE_PREFIX}${book}_${lessonId}`;
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  }

  // 获取某册书的所有进度
  getBookProgress(book) {
    const lessons = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(`${this.STORAGE_PREFIX}${book}_`)) {
        const data = localStorage.getItem(key);
        if (data) lessons.push(JSON.parse(data));
      }
    }
    return lessons;
  }

  // 更新学习统计
  updateStatistics(book, lessonId, data = {}) {
    const stats = this.getStatistics();
    
    // 更新今日学习
    if (!stats.daily[this.TODAY]) {
      stats.daily[this.TODAY] = {
        lessons: new Set(),
        duration: 0,
        sentences: 0
      };
    } else {
      // Convert array back to Set for existing data
      stats.daily[this.TODAY].lessons = new Set(stats.daily[this.TODAY].lessons);
    }
    
    stats.daily[this.TODAY].lessons.add(`${book}_${lessonId}`);
    stats.daily[this.TODAY].duration += data.duration || 0;
    stats.daily[this.TODAY].sentences += data.sentenceCount || 0;
    
    // Convert Set to Array for storage
    stats.daily[this.TODAY].lessons = Array.from(stats.daily[this.TODAY].lessons);
    
    // 更新总计
    stats.total.duration += data.duration || 0;
    stats.total.lessons = this.getTotalLessonCount();
    stats.total.days = Object.keys(stats.daily).length;
    stats.total.lastStudy = Date.now();
    
    // 计算连续学习天数
    stats.streak = this.calculateStreak(stats.daily);
    
    localStorage.setItem(this.STATS_KEY, JSON.stringify(stats));
    return stats;
  }

  // 获取统计数据
  getStatistics() {
    const data = localStorage.getItem(this.STATS_KEY);
    if (!data) {
      return {
        total: {
          duration: 0,
          lessons: 0,
          days: 0,
          lastStudy: null
        },
        daily: {},
        streak: 0
      };
    }
    return JSON.parse(data);
  }

  // 计算连续学习天数
  calculateStreak(daily) {
    const dates = Object.keys(daily).sort().reverse();
    if (dates.length === 0) return 0;
    
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let i = 0; i < dates.length; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(checkDate.getDate() - i);
      const dateStr = this.getDateString(checkDate);
      
      if (dates.includes(dateStr)) {
        streak++;
      } else if (i > 0) {
        // 如果不是今天且断了，停止计算
        break;
      }
    }
    
    return streak;
  }

  // 获取总课程数
  getTotalLessonCount() {
    let count = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(this.STORAGE_PREFIX) && key !== this.STATS_KEY) {
        count++;
      }
    }
    return count;
  }

  // 标记句子已学习
  markSentenceLearned(book, lessonId, sentenceIndex, duration = 0) {
    const progress = this.getLessonProgress(book, lessonId) || {};
    if (!progress.sentences) progress.sentences = {};
    
    progress.sentences[sentenceIndex] = {
      learned: true,
      count: (progress.sentences[sentenceIndex]?.count || 0) + 1,
      lastTime: Date.now(),
      totalDuration: (progress.sentences[sentenceIndex]?.totalDuration || 0) + duration
    };
    
    // 检查是否所有句子都已学习
    const totalSentences = progress.totalSentences || 0;
    const learnedSentences = Object.keys(progress.sentences).filter(
      idx => progress.sentences[idx].learned
    ).length;
    
    if (totalSentences > 0 && learnedSentences >= totalSentences) {
      progress.completed = true;
    }
    
    return this.saveLessonProgress(book, lessonId, progress);
  }

  // 获取学习热力图数据
  getHeatmapData(days = 30) {
    const stats = this.getStatistics();
    const heatmap = [];
    const today = new Date();
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = this.getDateString(date);
      
      heatmap.push({
        date: dateStr,
        value: stats.daily[dateStr]?.duration || 0,
        lessons: stats.daily[dateStr]?.lessons?.length || 0
      });
    }
    
    return heatmap;
  }

  // 格式化时长
  formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}小时${minutes}分钟`;
    } else if (minutes > 0) {
      return `${minutes}分钟${secs}秒`;
    } else {
      return `${secs}秒`;
    }
  }

  // 清除所有进度数据（谨慎使用）
  clearAllProgress() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(this.STORAGE_PREFIX) || key === this.STATS_KEY) {
        keys.push(key);
      }
    }
    keys.forEach(key => localStorage.removeItem(key));
  }

  // 导出进度数据
  exportProgress() {
    const data = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      statistics: this.getStatistics(),
      progress: {}
    };
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(this.STORAGE_PREFIX) && key !== this.STATS_KEY) {
        data.progress[key] = JSON.parse(localStorage.getItem(key));
      }
    }
    
    return data;
  }

  // 导入进度数据
  importProgress(data) {
    if (data.version !== '1.0') {
      throw new Error('不支持的数据版本');
    }
    
    // 导入统计数据
    if (data.statistics) {
      localStorage.setItem(this.STATS_KEY, JSON.stringify(data.statistics));
    }
    
    // 导入进度数据
    if (data.progress) {
      Object.keys(data.progress).forEach(key => {
        localStorage.setItem(key, JSON.stringify(data.progress[key]));
      });
    }
    
    return true;
  }
}

// 创建全局实例
window.progressManager = new ProgressManager();
