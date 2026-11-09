import { describe, expect, it } from 'vitest';
import { parseWorkflowReport, workflowReportUrl, workflowReportDocument } from '../src/workflow-report.js';

describe('workflow report', () => {
  it('preserves the edited document as authoritative and omits reference media from legacy conversion', () => {
    const report = parseWorkflowReport({ version: 1, facts: [{ label: '数量', value: '3' }], sections: [], references: [{ title: '参考图', url: 'https://example.com/image' }], checks: [] })!;
    expect(workflowReportDocument(report)).toContain('数量');
    expect(workflowReportDocument(report)).not.toContain('参考图');
    const edited = parseWorkflowReport({ ...report, document: '自由编辑后的完整方案' })!;
    expect(workflowReportDocument(edited)).toBe('自由编辑后的完整方案');
  });
  it('accepts serialized nested reports and preserves editable dimensions', () => {
    const value = { version: 1, facts: [], sections: [{ title: '美学目标', body: '', fields: [{ label: '运镜等级', value: '环绕' }] }] };
    expect(parseWorkflowReport(JSON.stringify(value))).toEqual(parseWorkflowReport(value));
    expect(parseWorkflowReport(value)?.sections[0]?.fields?.[0]?.value).toBe('环绕');
    expect(parseWorkflowReport('{bad')).toBeNull();
  });
  it('leaves existing and malformed results on the original list renderer', () => {
    for (const value of [undefined, null, {}, { version: 2 }, { version: 1, facts: [] }]) expect(parseWorkflowReport(value)).toBeNull();
  });
  it('normalizes uncertain checks and bounds comparisons without inventing a pass', () => {
    const report = parseWorkflowReport({ version: 1, facts: [], sections: [], checks: [{ label: '文化审查' }],
      comparison: { columns: ['档位', '时长'], rows: [['A', '6s', 'ignored'], ['B']] } });
    expect(report?.checks[0]?.status).toBe('pending');
    expect(report?.comparison?.rows).toEqual([['A', '6s'], ['B', '']]);
  });
  it('rejects executable URLs and protocol-relative sources', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,hello', '//other.test/a', '/\\other.test/a']) expect(workflowReportUrl(value)).toBeUndefined();
    expect(workflowReportUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(workflowReportUrl('/api/projects/p/raw/ref.png')).toBe('/api/projects/p/raw/ref.png');
  });
});
