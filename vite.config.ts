import { defineConfig, type Plugin } from 'vite'

/**
 * PWA：自己產生 Service Worker，不引入 workbox / vite-plugin-pwa。
 *
 * 理由：本專案的原則是執行期零相依、開發相依極少。整個離線需求只有
 * 「把打包出來的檔案預先快取起來」，用 30 行自己寫比拉進一整套框架更好維護。
 *
 * 關鍵是 precache 清單必須包含 Vite 加了 hash 的檔名，所以在 generateBundle
 * 階段才知道要快取什麼——這是不能手寫 sw.js 的原因。
 */
function pwaPlugin(): Plugin {
  // public/ 底下的檔案不會出現在 bundle 裡（Vite 直接複製），所以手動列出
  const staticAssets = ['./manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png']

  return {
    name: 'tdwordwar-pwa',
    apply: 'build',
    generateBundle(_options, bundle) {
      const hashed = Object.keys(bundle).map((f) => `./${f}`)
      const precache = ['./', './index.html', ...hashed, ...staticAssets]

      // 版本號同時涵蓋「檔名清單」與「SW 自己的邏輯」：
      // 只改 SW 程式碼而資源 hash 沒變時，也必須換快取名，否則舊的壞快取會留著。
      const template = swSource(precache, '__VERSION__')
      const version = simpleHash(template)

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template.replace('__VERSION__', version),
      })
    },
  }
}

function simpleHash(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

function swSource(precache: string[], version: string): string {
  return `/* 自動產生，請勿手改。產生器在 vite.config.ts 的 pwaPlugin() */
const CACHE = 'tdwordwar-${version}'
const PRECACHE = ${JSON.stringify(precache, null, 2)}

/**
 * ★ 存進 Cache 前重建一組乾淨的 headers，只保留 content-type。
 *
 * 不能直接把伺服器的 headers 原封不動存起來，有兩個會壞掉的地方：
 *
 *   1. content-encoding: gzip —— fetch() 拿到的 body 已經解壓縮過了，但 header
 *      還留著。SW 把它回給瀏覽器的子資源載入器時，載入器會照 header 再解壓一次
 *      純文字 → 解碼失敗 → net::ERR_FAILED。
 *   2. transfer-encoding: chunked（以及 connection / keep-alive）是 hop-by-hop
 *      header，不該出現在合成的 Response 上。<script type="module"> 的載入檢查
 *      很嚴格，看到它就直接拒絕，症狀是「CSS 出來了但 JS 完全沒執行」。
 *
 * 所以與其列黑名單，不如只留下真正需要的 content-type。
 */
async function store(cache, key, res) {
  const headers = new Headers()
  const ct = res.headers.get('content-type')
  if (ct) headers.set('content-type', ct)
  headers.set('cache-control', 'no-cache')
  const body = await res.blob()
  await cache.put(key, new Response(body, { status: 200, statusText: 'OK', headers }))
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // 逐一放入而不用 addAll：任何一個檔案 404 都不該讓整個安裝失敗
      await Promise.allSettled(
        PRECACHE.map(async (url) => {
          const res = await fetch(new Request(url, { cache: 'reload' }))
          if (res.ok) await store(cache, url, res)
        }),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // 導覽請求：先走網路（才拿得到新版），離線時回退到快取的首頁
  if (req.mode === 'navigate') {
    e.respondWith(
      (async () => {
        try {
          return await fetch(req)
        } catch {
          const cache = await caches.open(CACHE)
          return (
            (await cache.match(req)) ||
            (await cache.match('./index.html')) ||
            (await cache.match('./')) ||
            new Response('離線中，且沒有快取可用。', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          )
        }
      })(),
    )
    return
  }

  // 其餘資源：cache-first。Vite 的檔名帶 hash，內容不會變，所以快取永遠有效
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const hit = await cache.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok && res.type === 'basic') {
        // 不能 await：要立刻把 response 回給頁面，寫快取在背景做
        store(cache, req, res.clone()).catch(() => {})
      }
      return res
    })(),
  )
})
`
}

export default defineConfig({
  base: './',
  server: { port: 5188, host: true },
  build: { target: 'es2022', outDir: 'dist' },
  plugins: [pwaPlugin()],
})
