export type DocActionResult = { instanceId?: string; content?: string; revision?: string; meta?: { name?: string }; mirror?: { status?: string; path?: string } };

export async function callDocAction(endpoint: string, action: string, input: Record<string, unknown>, headers: Record<string, string>, docId?: string): Promise<DocActionResult> {
  const scope = docId ? `/instances/${encodeURIComponent(docId)}` : '';
  const response = await fetch(`${endpoint.replace(/\/+$/, '')}${scope}/actions/${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ input }),
  });
  const body = await response.json() as { data?: { result?: DocActionResult }; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `doc ${action}: HTTP ${response.status}`);
  if (!body.data?.result) throw new Error('文档服务未返回有效结果');
  return body.data.result;
}

/** Opening a detail must not overwrite the App's authoritative document with
 * an older canvas mirror. create seeds NEW documents only; read supplies truth. */
export async function openBoundDoc(endpoint: string, input: Record<string, unknown>, headers: Record<string, string>) {
  const created = await callDocAction(endpoint, 'doc.create', input, headers);
  if (!created.instanceId) throw new Error('文档服务未返回文档 ID');
  const read = await callDocAction(endpoint, 'doc.read', {}, headers, created.instanceId);
  if (typeof read.content !== 'string') throw new Error('文档正文读取失败，未覆盖画布或文档');
  return { instanceId: created.instanceId, name: read.meta?.name ?? created.meta?.name, content: read.content, revision: read.revision };
}
