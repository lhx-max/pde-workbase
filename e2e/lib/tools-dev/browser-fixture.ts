import { createServer } from 'node:http';
export const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP4QAAAAASUVORK5CYII=', 'base64');
/** Real local web content for the embedded browser, not a mocked workspace API. */
export async function createBrowserFixture() {
  const server = createServer((req, res) => {
    if (req.url?.split('?')[0] === '/image.png') { res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': pngBytes.length }); res.end(pngBytes); return; }
    if (req.url === '/vector.svg') { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#299e8d"/></svg>'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>原生浏览器参考页面</title><style>body{margin:0;font:20px system-ui;background:#eff3f0;color:#183a36}main{padding:70px;max-width:1050px;margin:auto}h1{font-size:70px;letter-spacing:-3px;max-width:780px}p{max-width:750px;line-height:1.6}.images{display:flex;gap:30px;margin:40px 0}img{width:160px;height:120px;object-fit:cover;border:2px solid #a0b3ad;border-radius:18px}a{color:#126a61}</style></head><body><main><p>本地参考资料 / 原生浏览器</p><h1 id="headline">将参考资料采集到当前项目。</h1><p>此确定性页面验证原生导航、安全资源发现、原始位图采集与项目本地持久保存，无需账户或外部网络。</p><div class="images"><img alt="已验证的 PNG 资源" src="/image.png?private=redacted"><img alt="仅元数据的 SVG" src="/vector.svg"></div><a id="next" href="/second">打开第二页</a><p id="page-marker">${req.url === '/second' ? '第二页' : '第一页'}</p></main></body></html>`);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture listener not available');
  return { url: `http://127.0.0.1:${address.port}`, async dispose() { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
