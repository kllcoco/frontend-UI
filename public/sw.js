/* CIRO offline shell. Never cache /api, POST, cookies, private content or user files. */
const CACHE="ciro-public-shell-v07";
const SHELL=["/","/index.html","/ciro-mark.svg","/manifest.webmanifest"];
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(x=>x!==CACHE).map(x=>caches.delete(x))))
    .then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
  const req=event.request;
  if(req.method!=="GET"||req.headers.has("authorization"))return;
  let url;try{url=new URL(req.url);}catch{return;}
  if(url.origin!==self.location.origin||url.pathname.startsWith("/api/"))return;
  const isNavigation=req.mode==="navigate";
  const isAsset=/^\/(assets\/[A-Za-z0-9_.-]+\.(?:js|css|svg|png|woff2)|backgrounds\/[a-z-]+\.svg|ciro-mark\.svg|manifest\.webmanifest)$/.test(url.pathname);
  if(!isNavigation&&!isAsset)return;
  event.respondWith((async()=>{
    if(isAsset){
      const cached=await caches.match(req);
      if(cached)return cached;
    }
    try{
      const response=await fetch(req);
      if(response.ok&&response.type==="basic"&&!response.headers.has("set-cookie")&&
        (isAsset||url.pathname==="/"||url.pathname==="/index.html")){
        const store=await caches.open(CACHE);
        await store.put(isNavigation?"/index.html":req,response.clone());
      }
      return response;
    }catch{
      return (await caches.match(isNavigation?"/index.html":req))||
        new Response("Ciro is offline. Reconnect to use the model and Studio services.",
          {status:503,headers:{"Content-Type":"text/plain; charset=utf-8"}});
    }
  })());
});
