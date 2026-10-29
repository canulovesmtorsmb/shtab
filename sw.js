var CACHE="shtab-v3";
self.addEventListener("install",function(e){self.skipWaiting();e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(["./","./index.html"]).catch(function(){});}));});
self.addEventListener("activate",function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return k===CACHE?null:caches.delete(k);}));}).then(function(){return self.clients.claim();}));});
self.addEventListener("fetch",function(e){
  if(e.request.method!=="GET")return;
  var u=new URL(e.request.url);
  if(u.origin!==self.location.origin)return;
  // сеть первой и мимо HTTP-кэша браузера (сверка по ETag), чтобы новая версия приходила с первого открытия
  e.respondWith(fetch(u.href,{cache:"no-cache",credentials:"same-origin"}).then(function(r){if(r&&r.redirected)return fetch(e.request);if(r&&r.ok){var cp=r.clone();caches.open(CACHE).then(function(c){c.put(e.request,cp);});}return r;})
   .catch(function(){return caches.match(e.request).then(function(r){return r||caches.match("./index.html");});}));
});
