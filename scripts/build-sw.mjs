import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const base = process.env.VITE_BASE_PATH || "/";
const files = (await readdir("dist", { recursive: true })).filter(
  (f) =>
    !f.endsWith("/") &&
    !f.includes("licenses/") &&
    /\.(js|css|html|svg|png|webmanifest)$/.test(f) &&
    f !== "sw.js",
);
const hash = createHash("sha256");
for (const file of files) hash.update(await readFile("dist/" + file));
const version = "mypianow-" + hash.digest("hex").slice(0, 12),
  urls = files.map((f) => base + f);
const source = `const CACHE=${JSON.stringify(version)},BASE=${JSON.stringify(base)},SHELL=${JSON.stringify(urls)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL))));
self.addEventListener('message',e=>{if(e.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('mypianow-')).slice(0,-2).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const url=new URL(e.request.url);if(e.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(BASE)||url.pathname.includes('/licenses/'))return;
if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match(BASE+'index.html')));return;}
e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request)));});
`;
await writeFile("dist/sw.js", source);
console.log("PWA shell:", files.length, "assets;", version);
