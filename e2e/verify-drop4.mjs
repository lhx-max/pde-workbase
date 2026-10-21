import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('response', async r => {
  const u = r.url();
  if (u.includes('/api/apps/') && r.request().method() !== 'GET') {
    console.log(r.status(), r.request().method(), u.replace('http://127.0.0.1:','').slice(0,110));
    if (!r.ok()) console.log('   body:', (await r.text()).slice(0,200));
  }
});
await page.goto('http://127.0.0.1:17580/?projectId=canvas-489ee898-a2a', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(5000);
await page.evaluate(async () => {
  const file = new File(['# 用户复现\n\n内容在此\n'], '复现.md', { type: 'text/markdown' });
  const dt = new DataTransfer(); dt.items.add(file);
  document.querySelector('.xy-flow-host').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 800, clientY: 350, dataTransfer: dt }));
});
await page.waitForTimeout(6000);
console.log('banner:', await page.evaluate(() => document.querySelector('.df-upload-banner')?.textContent?.slice(0,200) ?? 'none'));
const st = await (await fetch('http://127.0.0.1:17462/api/apps/canvas/instances/canvas-489ee898-a2a/state')).json();
const n = st.data.state.workbenchBasicNodes.at(-1);
console.log('card:', n.id, JSON.stringify(n.text?.slice(0,40)));
await browser.close();
