// Chinese screenshot content adapted from the public E2E fixtures in ../lib/api.ts.
// Keep the real HTTP writes, preview layout, interaction and deck structure unchanged.
import { api } from '@/api';
import type { ToolsDevRuntime } from '@/tools-dev/runtime';

export const webDocument = (title = '画布研究') => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title><style>body{margin:0;background:#f1f4f8;color:#203245;font:18px system-ui}main{max-width:840px;margin:60px auto;padding:48px;background:white;border-radius:24px}h1{font-size:52px;line-height:1.05;letter-spacing:-2px}p{line-height:1.65}.tag{font-size:12px;letter-spacing:2px;color:#227d6b}button{background:#203245;color:white;border:0;border-radius:10px;padding:14px 20px}</style></head><body><main><p class="tag">画布工作区 / 研究笔记</p><h1 id="headline">${title}</h1><p>独立开展创意工作：探索参考资料，关联项目素材，编辑原始文档，并在画布旁保存每次修订。</p><p>此本地测试页面不依赖账户、网络素材库或聊天功能。它通过真实的项目文件验证原始预览与源码界面。</p><button id="interactive-example">验证交互</button></main><script>const button=document.querySelector('#interactive-example');button.addEventListener('click',()=>{button.textContent='交互验证成功'});document.documentElement.dataset.fixtureReady='true';</script></body></html>`;

const deckDocument = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>工作区演示文稿</title><style>html,body{margin:0;background:#122839;color:white;font:24px system-ui}.slide{width:1280px;height:720px;box-sizing:border-box;padding:90px;position:absolute;inset:0;background:#122839;color:white}.slide h1{font-size:80px;max-width:900px;letter-spacing:-3px}.slide p{font-size:28px;max-width:850px;line-height:1.5}.slide[data-slide="2"]{background:#e8eee8;color:#203c36}</style></head><body><deck-stage width="1280" height="720"><section class="slide" data-slide="1"><p>画布工作区</p><h1>从参考资料到最终交付。</h1><p>本地、独立的创意工作区，保留原始画布、项目文件与原生浏览器采集能力。</p></section><section class="slide" data-slide="2"><p>围绕项目组织素材</p><h1>让素材与作品保持相伴。</h1><p>无需账户平台或聊天界面，即可浏览、采集、修订与导出。</p></section></deck-stage></body></html>`;

export async function writePresentation(runtime: ToolsDevRuntime, projectId: string, name: string) {
  return api<{ file: { name: string; artifactManifest: { kind: string; renderer: string } } }>(runtime, `/api/projects/${projectId}/files`, {
    name, content: deckDocument, artifactManifest: { kind: 'deck', renderer: 'deck-html', exports: ['html', 'pdf'], status: 'complete', title: '工作区演示文稿' },
  });
}
