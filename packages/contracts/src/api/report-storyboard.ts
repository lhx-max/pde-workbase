import { parseWorkflowReport, workflowReportDocument } from '../workflow-report.js';

export type ReportStoryboardRequirements = {
  tier: string;
  shotCount: number;
  totalDurationSec: number;
};
export type ReportStoryboardTask = ReportStoryboardRequirements & { quantity: number; context: string };

const numbers = (text: string) => (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

/** Read explicit structured report values only. Ambiguity is not a license to invent a budget. */
export function reportStoryboardTasks(value: unknown): ReportStoryboardTask[] {
  const report = parseWorkflowReport(value);
  if (!report || report.document !== undefined) throw new Error('请使用包含档位、镜头数和总时长的结构化方案');
  const membership = report.facts.find(f => f.label === '会员等级与生产数量')?.value ?? '';
  const tierEntries = membership.split(/[，,；;]/)[0]!.split(/\s*[/／、→]\s*/).map(s => s.trim()).filter(Boolean);
  const tiers = tierEntries.map(s => s.replace(/\s*\d+\s*款\s*$/, '').trim());
  if (!tiers.length || tiers.some(s => /\d|各|共/.test(s))) throw new Error('请明确填写档位顺序，例如：基础 / 进阶 / 典藏，各 1 款，共 3 款');
  const each = membership.match(/各\s*(\d+)\s*款/);
  const quantities = tierEntries.map(entry => Number(each?.[1] ?? entry.match(/(\d+)\s*款\s*$/)?.[1]));
  if (quantities.some(n => !Number.isInteger(n) || n < 1)) throw new Error('请明确填写每档生产数量（各 N 款，或分别填写档位 N 款）');
  const totalQuantity = quantities.reduce((a, b) => a + b, 0);
  const total = membership.match(/共\s*(\d+)\s*款/);
  if (total && Number(total[1]) !== totalQuantity) throw new Error('报告中的每档数量与总生产数量不一致');
  if (totalQuantity > 20) throw new Error('当前单次最多拆分 20 份剧本，请减少本轮生产数量');
  const readBudget = (rowLabel: string, fieldLabel: string) => {
    const row = report.comparison?.rows.find(row => row[0] === rowLabel);
    const field = report.sections.flatMap(section => section.fields ?? []).find(field => field.label === fieldLabel);
    const values = [row?.[1], field?.value].filter((v): v is string => Boolean(v?.trim()));
    if (!values.length) throw new Error(`报告缺少${rowLabel}`);
    const lists = values.map(text => {
      if (/待|约|大概|[-–~～至]/.test(text) || /分钟|小时|分\b/.test(text)) throw new Error(`${rowLabel}必须填写确定数值，时长单位使用秒`);
      const result = numbers(text);
      const namedOrder = tiers.filter(tier => text.includes(tier)).sort((a, b) => text.indexOf(a) - text.indexOf(b));
      if (namedOrder.length && (namedOrder.length !== tiers.length || namedOrder.some((name, i) => name !== tiers[i]))) throw new Error(`${rowLabel}的档位顺序与机制目标不一致`);
      if (result.length !== tiers.length) throw new Error(`${rowLabel}需要按 ${tiers.join(' / ')} 顺序填写 ${tiers.length} 个数值`);
      return result;
    });
    if (lists.some(list => JSON.stringify(list) !== JSON.stringify(lists[0]))) throw new Error(`${rowLabel}与${fieldLabel}不一致，请先统一报告`);
    return lists[0]!;
  };
  const counts = readBudget('总镜头', '镜头数量等级');
  const durations = readBudget('总时长', '时长等级');
  const context = workflowReportDocument(report);
  return tiers.map((tier, i) => {
    const shotCount = counts[i]!; const totalDurationSec = durations[i]!;
    if (!Number.isInteger(shotCount) || shotCount < 1 || shotCount > 50) throw new Error(`${tier}镜头数必须为 1–50 的整数`);
    if (!Number.isFinite(totalDurationSec) || totalDurationSec < shotCount * 4 || totalDurationSec > shotCount * 30) throw new Error(`${tier}每镜至少 4 秒，${shotCount} 镜总时长至少 ${shotCount * 4} 秒（每镜最多 30 秒），请调整报告`);
    return { tier, quantity: quantities[i]!, shotCount, totalDurationSec, context };
  });
}

export function validateReportStoryboard(shots: readonly { durationSec: number }[], requirements: ReportStoryboardRequirements): void {
  if (shots.some(shot => !Number.isFinite(shot.durationSec) || shot.durationSec < 4 || shot.durationSec > 30)) throw new Error('每个镜头必须为 4–30 秒，请调整方案后重新生成');
  if (!Number.isInteger(requirements.shotCount) || requirements.shotCount < 1 || requirements.shotCount > 50 || !Number.isFinite(requirements.totalDurationSec) || requirements.totalDurationSec <= 0) throw new Error('报告分镜约束无效，请重新确认方案');
  if (shots.length !== requirements.shotCount) throw new Error(`${requirements.tier}要求 ${requirements.shotCount} 镜，实际返回 ${shots.length} 镜，未采用结果`);
  const duration = shots.reduce((sum, shot) => sum + shot.durationSec, 0);
  if (Math.abs(duration - requirements.totalDurationSec) > 0.001) throw new Error(`${requirements.tier}要求总时长 ${requirements.totalDurationSec} 秒，实际返回 ${duration} 秒，未采用结果`);
}
