class FavoritesManager {
  constructor(){this.KEY='english_reader_favorites_v1';this.VOCAB='english_reader_vocabulary_v1';}
  getFavorites(){let list=[];try{list=JSON.parse(localStorage.getItem(this.KEY)||'[]')}catch(_){}if(!list.length){try{list=JSON.parse(localStorage.getItem('nce_favorites')||'[]').map(x=>({...x,bookId:x.book||'nce2',sentenceId:String(x.sentenceIndex)}))}catch(_){}}return list;}
  isFavorite(bookId,lessonId,i){return this.getFavorites().some(f=>f.bookId===bookId&&f.lessonId===lessonId&&String(f.sentenceId)===String(i));}
  addFavorite(bookId,lessonId,i,d={}){if(this.isFavorite(bookId,lessonId,i))return false;const list=this.getFavorites();list.push({bookId,unitId:d.unitId||'',lessonId,sentenceId:String(i),unitTitle:d.unitTitle||'',lessonTitle:d.lessonTitle||'',en:d.en||'',cn:d.cn||'',start:d.start??null,end:d.end??null,timestamp:Date.now()});localStorage.setItem(this.KEY,JSON.stringify(list));return true;}
  removeFavorite(bookId,lessonId,i){const list=this.getFavorites(),next=list.filter(f=>!(f.bookId===bookId&&f.lessonId===lessonId&&String(f.sentenceId)===String(i)));localStorage.setItem(this.KEY,JSON.stringify(next));return next.length<list.length;}
  toggleFavorite(bookId,lessonId,i,d){return this.isFavorite(bookId,lessonId,i)?(this.removeFavorite(bookId,lessonId,i),false):(this.addFavorite(bookId,lessonId,i,d),true);}
  getVocabulary(){try{return JSON.parse(localStorage.getItem(this.VOCAB)||'[]')}catch(_){return[]}}
  addWord(word,context={}){const list=this.getVocabulary();if(list.some(x=>x.word.toLowerCase()===word.toLowerCase()))return false;list.push({word,...context,timestamp:Date.now(),reviewCount:0,lastReview:null});localStorage.setItem(this.VOCAB,JSON.stringify(list));return true;}
}
window.favoritesManager=new FavoritesManager();
