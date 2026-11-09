const base = 'http://127.0.0.1:17456';
const health = await (await fetch(`${base}/api/health`)).json();
if (health.storage?.canvas !== 'explicit-local-runtime') throw new Error('仅修复本地 demo');
const { projects } = await (await fetch(`${base}/api/projects`)).json();
for (const project of projects) {
  if (!project.id.startsWith('drama-demo-')) continue;
  const { data } = await (await fetch(`${base}/api/apps/canvas/instances/${project.id}/state`)).json();
  const nodes = data.state.workbenchBasicNodes ?? [];
  const editor = nodes.find((node: { kind: string; data?: Record<string, unknown> }) => node.kind === 'card.drama.audio' && node.data?.stage !== 'rewrite');
  if (!editor) continue;
  const next = nodes.map((node: { id: string; kind: string; data?: Record<string, unknown> }) => node.id === editor.id ? {
    ...node, title: '② 配音区间编辑与视频对齐', x: 760, y: 0, width: 720, height: 1100,
    demoProfile: 'local-test', demoProjectId: project.id,
    data: { ...node.data, stage: 'edit', demoProfile: 'local-test', demoProjectId: project.id },
  } : node.kind === 'video' ? { ...node, x: 1520, y: 0 } : node);
  if (!nodes.some((node: { data?: Record<string, unknown> }) => node.data?.stage === 'rewrite')) {
    next.push({ id: 'drama-rewrite', kind: 'card.drama.audio', title: '① 视频与解说词 · 万擎改写', x: 0, y: 0, width: 680, height: 1100,
      demoProfile: 'local-test', demoProjectId: project.id,
      data: { stage: 'rewrite', demoProfile: 'local-test', demoProjectId: project.id, downstreamNodeId: editor.id,
        videoRef: editor.data.videoRef, videoDurationMs: editor.data.videoDurationMs, script: editor.data.script,
        rewriteLines: [], rewriteDoc: null, rewriteProvider: null },
    });
  }
  const response = await fetch(`${base}/api/projects/${project.id}/canvas/state`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: data.revision, changes: { workbenchBasicNodes: next } }),
  });
  if (!response.ok) throw new Error(`修复实例失败 HTTP ${response.status}`);
  console.log(`已迁移两卡流程 ${project.id}`);
}
