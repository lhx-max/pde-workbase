import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://127.0.0.1:17580/?projectId=canvas-489ee898-a2a', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(5000);
await page.evaluate(async () => {
  const file = new File(['# 名字验证\n\n正文\n'], '我的报告.md', { type: 'text/markdown' });
  const dt = new DataTransfer(); dt.items.add(file);
  document.querySelector('.xy-flow-host').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 700, clientY: 350, dataTransfer: dt }));
});
await page.waitForTimeout(6000);
const st = await (await fetch('http://127.0.0.1:17462/api/apps/canvas/instances/canvas-489ee898-a2a/state')).json();
const n = st.data.state.workbenchBasicNodes.at(-1);
console.log('card:', n?.id, JSON.stringify((n?.text||'').slice(0,30)));
const docs = await (await fetch('http://127.0.0.1:19000/api/apps/doc/instances')).json();
const bound = docs.data.items.find(m => m.nodeId === n?.id);
console.log('bound doc:', bound?.id, '| name:', bound?.name);
console.log('tabs:', await page.evaluate(() => [...document.querySelectorAll('.ws-tab-label')].map(e => e.textContent)));
await browser.close();
