(() => {
  const LANG_KEY='english_reader_lang_mode';
  function getLang(){const v=localStorage.getItem(LANG_KEY)||localStorage.getItem('nce_lang_mode');return ['en','bi','cn'].includes(v)?v:'bi';}
  function setLang(v){localStorage.setItem(LANG_KEY,v);applyLang(v);}
  function applyLang(v){document.body.classList.remove('lang-en','lang-bi','lang-cn');document.body.classList.add('lang-'+v);}
  function initSegmented(container){const segs=container?.querySelectorAll('[data-mode]');if(!segs)return;const current=getLang();applyLang(current);segs.forEach(btn=>{btn.classList.toggle('active',btn.dataset.mode===current);btn.addEventListener('click',()=>{setLang(btn.dataset.mode||'bi');segs.forEach(b=>b.classList.toggle('active',b===btn));});});}
  window.NCE_APP={getLang,setLang,applyLang,initSegmented};
})();
