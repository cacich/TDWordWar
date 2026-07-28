/**
 * Service Worker 註冊。
 *
 * sw.js 是 build 時由 vite.config.ts 的 pwaPlugin() 產生的（裡面帶著這次打包的
 * 檔名清單），所以開發模式沒有這個檔案 —— 只在 production 註冊。
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    // 用相對路徑：base 是 './'，部署到子目錄（GitHub Pages 之類）也能正確取得 scope
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      /* 註冊失敗不影響遊玩（例如 http 非 localhost 環境），靜默忽略 */
    })
  })
}

/**
 * 是否以「已安裝的 App」形式執行。
 * 用來決定要不要顯示安裝提示。
 */
export function isStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  if (window.matchMedia('(display-mode: minimal-ui)').matches) return true
  // iOS Safari 的非標準屬性
  return Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
}
