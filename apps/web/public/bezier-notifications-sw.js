// Browser service workers must be served as JavaScript files. Keep this
// worker cache-free: it handles notification clicks and supplies a recoverable
// document when a previously opened browser tab cannot reach the web service.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

// Deliberately self-contained: no React, fonts, scripts or images can be
// downloaded while the app server is unavailable.
function reconnectPage() {
  const button = document.querySelector('button');
  const label = document.querySelector('#retry-label');
  const detail = document.querySelector('#detail');
  const state = document.querySelector('#state');
  const zh = document.documentElement.lang === 'zh-CN';
  let checking = false;
  let timer;
  let failures = 0;
  let leaving = false;
  function schedule() {
    clearTimeout(timer);
    if (!leaving && !document.hidden) timer = setTimeout(check, Math.min(4000 * 2 ** Math.min(failures, 3), 30000));
  }
  async function check() {
    if (checking || leaving) return;
    clearTimeout(timer);
    checking = true;
    button.disabled = true;
    document.body.dataset.checking = 'true';
    label.textContent = zh ? '正在检测' : 'Checking';
    state.textContent = zh ? '正在连接服务…' : 'Checking the connection…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(location.href, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      const ready = response.status < 500 && (response.headers.get('Content-Type') || '').includes('text/html');
      if (response.body) await response.body.cancel();
      if (!ready) throw new Error('Service not ready');
      leaving = true;
      state.textContent = zh ? '连接已恢复，正在返回…' : 'Connected. Returning to your workspace…';
      location.reload();
    } catch {
      failures += 1;
      detail.textContent = zh ? '服务仍未响应。你可以重试，或重新打开 Loom。' : 'The service is still unavailable. Try again, or reopen Loom.';
      state.textContent = zh ? '恢复后自动返回' : 'Returns automatically when ready';
    } finally {
      clearTimeout(timeout);
      checking = false;
      if (!leaving) {
        button.disabled = false;
        document.body.dataset.checking = 'false';
        label.textContent = zh ? '重试连接' : 'Try again';
        schedule();
      }
    }
  }
  button.addEventListener('click', check);
  window.addEventListener('online', check);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(timer); else void check(); });
  schedule();
}

function offlinePage(url, language) {
  const chinese = language.toLowerCase().startsWith('zh');
  const title = chinese ? '暂时连接不上' : 'Connection interrupted';
  const detail = chinese ? '正在等待服务恢复，恢复后会自动返回。' : 'Waiting for the service. Your workspace will reopen when it is ready.';
  const action = chinese ? '重试连接' : 'Try again';
  const status = chinese ? '恢复后自动返回' : 'Returns automatically when ready';
  return new Response(`<!doctype html>
<html lang="${chinese ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${title} · Loom</title>
<style>
:root{--canvas:#f7f7f5;--surface:#fff;--ink:#191918;--muted:#71716c;--edge:#e8e8e4;--accent:#8170d8;--soft:#f4f3f8;--shadow:0 24px 72px -32px #25232226,0 2px 5px #25232203;color-scheme:light}
*{box-sizing:border-box}body{margin:0;min-height:100vh;min-height:100svh;display:grid;place-items:center;padding:24px;background:var(--canvas);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.card{text-align:center;width:min(440px,100%);padding:32px 36px 0;border:1px solid var(--edge);border-radius:24px;background:var(--surface);box-shadow:var(--shadow);animation:arrive .4s cubic-bezier(.23,1,.32,1)}
.brand{display:flex;align-items:center;justify-content:center;gap:8px;font-size:14px;font-weight:650;letter-spacing:-.4px}.brand svg{width:18px;height:18px;color:var(--accent)}
.connection{display:block;width:160px;height:76px;margin:36px auto 25px;overflow:visible}.endpoint{fill:var(--surface);stroke:var(--edge)}.glyph{fill:none;stroke:var(--muted);stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}.signal{fill:var(--accent);animation:signal 2.4s infinite}.signal:nth-of-type(2){animation-delay:.2s}.signal:nth-of-type(3){animation-delay:.4s}
h1{margin:0 0 12px;font-size:27px;line-height:1.3;font-weight:620;letter-spacing:-.8px}p{margin:0;color:var(--muted);font-size:14px;line-height:1.8;min-height:50px;text-wrap:pretty}
button{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:44px;margin:26px 0 30px;padding:0 18px;border:1px solid transparent;border-radius:12px;background:var(--ink);color:var(--surface);font-family:inherit;font-size:14px;font-weight:500;line-height:1;cursor:pointer;transition:transform .2s cubic-bezier(.23,1,.32,1),opacity .2s}button:hover:not(:disabled){transform:translateY(-1px);opacity:.88}button:active:not(:disabled){transform:translateY(0)}button:focus-visible{outline:3px solid var(--accent);outline-offset:4px}button:disabled{cursor:wait;opacity:.65}button svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}[data-checking=true] button svg{animation:spin 1s linear infinite}
.footer{display:flex;align-items:center;justify-content:center;gap:8px;min-height:56px;border-top:1px solid var(--edge);font-size:11px;color:var(--muted)}.status-dot{width:5px;height:5px;border-radius:50%;background:var(--accent);flex:none}
@keyframes arrive{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}@keyframes signal{0%,100%{opacity:.25}50%{opacity:1}}@keyframes spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}@media(max-width:420px){.card{padding:28px 26px 0}h1{font-size:25px}}
@media(prefers-color-scheme:dark){:root{--canvas:#171716;--surface:#222221;--ink:#f2f1ed;--muted:#acaca5;--edge:#353532;--accent:#b4a2f3;--soft:#302b3a;--shadow:0 24px 72px -32px #0008;color-scheme:dark}}
</style></head>
<body><main class="card" aria-labelledby="title">
<div class="brand">Loom</div>
<svg class="connection" viewBox="0 0 160 76" aria-hidden="true"><rect class="endpoint" x=".5" y="12.5" width="48" height="48" rx="14"/><path class="glyph" d="M16 30h17v13H16zM16 34h17M20 32h.1M23 32h.1"/><path d="M58 37h44" stroke="var(--edge)" stroke-dasharray="2 5"/><g><circle class="signal" cx="68" cy="37" r="2"/><circle class="signal" cx="80" cy="37" r="2"/><circle class="signal" cx="92" cy="37" r="2"/></g><rect class="endpoint" x="111.5" y="12.5" width="48" height="48" rx="14"/><path class="glyph" d="M135 25v24M123 37h24"/><circle cx="135" cy="37" r="4" fill="var(--surface)" stroke="var(--accent)" stroke-width="1.5"/></svg>
<h1 id="title">${title}</h1><p id="detail">${detail}</p>
<button type="button"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.5 7A7 7 0 1 0 17 12M16.5 2v5h-5"/></svg><span id="retry-label">${action}</span></button>
<noscript><a href="${escapeHtml(url)}">${action}</a></noscript><div class="footer"><span class="status-dot" aria-hidden="true"></span><span id="state" role="status" aria-live="polite">${status}</span></div>
</main><script>(${reconnectPage.toString()})();</script></body></html>`, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.status < 500) return response;
    } catch {
      // A failed navigation has no running React app to render the banner.
    }
    return offlinePage(event.request.url, event.request.headers.get('Accept-Language') || 'zh');
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const targetUrl = typeof data.url === 'string' ? data.url : self.location.origin;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    const sameOrigin = windows.find((client) => {
      try {
        return new URL(client.url).origin === self.location.origin;
      } catch {
        return false;
      }
    });

    if (sameOrigin) {
      if ('navigate' in sameOrigin) {
        try {
          await sameOrigin.navigate(targetUrl);
        } catch {
          /* focus the existing tab below */
        }
      }
      return sameOrigin.focus();
    }

    if (self.clients.openWindow) {
      return self.clients.openWindow(targetUrl);
    }
    return undefined;
  })());
});
