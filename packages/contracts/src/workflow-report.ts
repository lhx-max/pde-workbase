/** Optional report content for a structured workflow result, independent of business type. */
export interface WorkflowReport {
  version: 1;
  /** Authoritative user-edited proposal body. Legacy fields are only used before conversion. */
  document?: string;
  label: string;
  facts: Array<{ label: string; value: string }>;
  sections: Array<{ title: string; body: string; fields?: Array<{ label: string; value: string }> }>;
  comparison?: { title: string; columns: string[]; rows: string[][] };
  references: Array<{ title: string; purpose: string; url?: string; imageUrl?: string }>;
  checks: Array<{ label: string; detail: string; status: 'pending' | 'warning' | 'passed' }>;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** No executable HTML, arbitrary URL schemes, or unbounded generated collections. */
export function workflowReportUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const url = value.trim();
  if (/^https?:\/\//i.test(url) || /^\/(?!\/)[^\\]*$/.test(url)) return url;
  return undefined;
}

export function parseWorkflowReport(value: unknown): WorkflowReport | null {
  // JSON output contracts may serialize nested fields as strings.
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  const input = record(value);
  if (input.version !== 1 || !Array.isArray(input.sections) || !Array.isArray(input.facts)) return null;
  const text = (v: unknown) => typeof v === 'string' ? v : '';
  const list = (v: unknown) => Array.isArray(v) ? v.slice(0, 40).map(record) : [];
  const comparison = record(input.comparison);
  const columns = Array.isArray(comparison.columns) ? comparison.columns.slice(0, 16).map(text) : [];
  return {
    version: 1,
    ...(typeof input.document === 'string' ? { document: input.document } : {}),
    label: text(input.label) || '方案报告',
    facts: list(input.facts).map(v => ({ label: text(v.label), value: text(v.value) })),
    sections: list(input.sections).map(v => ({ title: text(v.title), body: text(v.body),
      ...(Array.isArray(v.fields) ? { fields: list(v.fields).map(f => ({ label: text(f.label), value: text(f.value) })) } : {}) })),
    ...(columns.length && Array.isArray(comparison.rows) ? { comparison: {
      title: text(comparison.title), columns,
      rows: comparison.rows.slice(0, 40).filter(Array.isArray).map(row => columns.map((_, i) => text(row[i]))),
    } } : {}),
    references: list(input.references).map(v => {
      const url = workflowReportUrl(v.url); const imageUrl = workflowReportUrl(v.imageUrl);
      return { title: text(v.title), purpose: text(v.purpose), ...(url ? { url } : {}), ...(imageUrl ? { imageUrl } : {}) };
    }),
    checks: list(input.checks).map(v => ({ label: text(v.label), detail: text(v.detail),
      status: v.status === 'passed' || v.status === 'warning' ? v.status : 'pending' })),
  };
}

/** Convert legacy structured proposals to editable prose; media references are not proposal content. */
export function workflowReportDocument(report: WorkflowReport): string {
  if (report.document !== undefined) return report.document;
  const blocks: string[] = [];
  if (report.facts.length) blocks.push('## 机制目标', ...report.facts.map(f => `**${f.label}**：${f.value}`));
  for (const section of report.sections) {
    blocks.push(`## ${section.title}`, section.body, ...(section.fields ?? []).map(f => `**${f.label}**：${f.value}`));
  }
  if (report.comparison) {
    blocks.push(`## ${report.comparison.title || '生成规则'}`);
    for (const row of report.comparison.rows) blocks.push(`### ${row[0] ?? ''}`, ...row.slice(1).map((v, i) => `**${report.comparison!.columns[i + 1] ?? ''}**：${v}`));
  }
  return blocks.filter(Boolean).join('\n\n');
}
