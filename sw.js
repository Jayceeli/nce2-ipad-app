const CORE_CACHE = 'english-reader-core-v1';
const MEDIA_CACHE = 'english-reader-media-v1';
const CONTENT_CACHE = 'english-reader-content-v1';
const LEGACY_MEDIA_CACHE = 'nce2-media-v1';
const LEGACY_CONTENT_CACHE = 'nce2-content-v1';
const PRELOAD_HEADER = 'X-English-Preload';
const CORE_FETCH_TIMEOUT_MS = 12000;
const CORE_CACHE_CONCURRENCY = 6;

const APP_SHELL = [
  './','index.html','lesson.html','settings.html','about.html','manifest.webmanifest','favicon.ico',
  'assets/app.js','assets/bootstrap.min.css','assets/common.js','assets/dictation.js','assets/extra.css',
  'assets/favorites.js','assets/home.js','assets/icons/apple-touch-icon.png','assets/icons/icon-192.png','assets/icons/icon-512.png',
  'assets/lesson.js','assets/notes.js','assets/progress.js','assets/register-sw-v8.js','assets/settings.js','assets/styles.css','assets/ui.js',
  'data/books.json','data/lessons.json','data/words.json','static/data.json',
  'books/nce2/book.json','books/shanghai-5a/book.json','books/shanghai-5a/lessons.json','books/shanghai-5a/words.json',
  'books/shanghai-5a/lrc/u01-talking.lrc','books/shanghai-5a/lrc/u01-story.lrc',
  'books/shanghai-5a/timings/u01-talking.json','books/shanghai-5a/timings/u01-story.json','notes/shanghai-5a/u01.html'
];
const REQUIRED_APP_SHELL = ['./','index.html','lesson.html','settings.html','assets/common.js','assets/lesson.js','assets/styles.css','data/books.json'];

async function fetchAndCache(cache, path) {
  const url = new URL(path, self.registration.scope).href;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CORE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache:'reload', signal:controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await cache.put(url, res);
  } finally { clearTimeout(timer); }
}

async function cacheMany(cache, paths, required) {
  const failures=[]; let next=0;
  await Promise.all(Array.from({length:Math.min(CORE_CACHE_CONCURRENCY,paths.length)}, async()=>{
    while(next<paths.length){ const path=paths[next++]; try{await fetchAndCache(cache,path);}catch(err){failures.push({path,err});console.warn('precache failed',path,err);} }
  }));
  if(required&&failures.length) throw new Error('Required app shell assets failed: '+failures.map(x=>x.path).join(', '));
}

self.addEventListener('install',(event)=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CORE_CACHE);
    const required=new Set(REQUIRED_APP_SHELL);
    await cacheMany(cache,REQUIRED_APP_SHELL,true);
    await cacheMany(cache,APP_SHELL.filter((p)=>!required.has(p)),false);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',(event)=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    const keep=new Set([CORE_CACHE,MEDIA_CACHE,CONTENT_CACHE,LEGACY_MEDIA_CACHE,LEGACY_CONTENT_CACHE]);
    await Promise.all(keys.filter((k)=>!keep.has(k)).map((k)=>caches.delete(k)));
    await self.clients.claim();
  })());
});

async function rangeResponse(fullResponse, rangeHeader) {
  const blob=await fullResponse.blob();
  const size=blob.size;
  const m=/bytes=(\d*)-(\d*)/.exec(rangeHeader||'');
  let start=0,end=size-1;
  if(m){ if(m[1])start=parseInt(m[1],10); if(m[2])end=parseInt(m[2],10); }
  if(start>=size) return new Response('',{status:416,headers:{'Content-Range':`bytes */${size}`}});
  end=Math.min(end,size-1);
  const sliced=blob.slice(start,end+1);
  return new Response(sliced,{status:206,headers:{
    'Content-Range':`bytes ${start}-${end}/${size}`,
    'Accept-Ranges':'bytes','Content-Length':String(sliced.size),
    'Content-Type':blob.type||fullResponse.headers.get('content-type')||'application/octet-stream'
  }});
}

async function handleMedia(request) {
  const range=request.headers.get('range');
  let full=await caches.match(request.url,{ignoreSearch:true});
  if(!full){
    const network=await fetch(request.url,{cache:'no-store'});
    if(!network.ok)return network;
    full=network.clone();
    try{const cache=await caches.open(MEDIA_CACHE);await cache.put(request.url,network.clone());}catch(err){console.warn('media cache failed',request.url,err);}
  }
  return range?rangeResponse(full,range):full;
}

self.addEventListener('fetch',(event)=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==location.origin)return;
  if(req.headers.get(PRELOAD_HEADER)==='1')return;

  if(/\.(mp3|ogg|m4a|wav)$/i.test(url.pathname)){
    event.respondWith(handleMedia(req)); return;
  }

  if(req.mode==='navigate'){
    event.respondWith(fetch(req).then((res)=>{
      if(res.ok){const copy=res.clone();caches.open(CORE_CACHE).then((c)=>c.put(req,copy));}
      return res;
    }).catch(()=>caches.match(req).then((r)=>r||caches.match('index.html'))));
    return;
  }

  event.respondWith(caches.match(req,{ignoreSearch:true}).then((cached)=>{
    if(cached)return cached;
    return fetch(req).then((res)=>{
      if(res.ok){const copy=res.clone();caches.open(CORE_CACHE).then((c)=>c.put(req,copy));}
      return res;
    });
  }));
});
