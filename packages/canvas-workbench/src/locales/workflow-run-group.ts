import { getCanvasActiveLocale } from '../platform/canvas-locale';

function zh() { return getCanvasActiveLocale().startsWith('zh'); }
const s = (cn: string, en: string) => (zh() ? cn : en);

export function wrg() {
  return {
    status: {
      pending: s('未开始', 'Not started'),
      blocked: s('等待前序', 'Waiting on earlier steps'),
      running: s('执行中', 'Running'),
      'awaiting-input': s('等待你确认', 'Waiting for you'),
      waiting: s('等待中', 'Waiting'),
      succeeded: s('已完成', 'Done'),
      failed: s('失败', 'Failed'),
      skipped: s('本次跳过', 'Skipped'),
      cancelled: s('已停止', 'Stopped'),
      terminated: s('已结束', 'Ended'),
    } as Record<string, string>,
    actionFailed: s('操作失败', 'Action failed'),
    unnamed: s('未命名产物', 'Untitled output'),
    stepFailed: s('此步骤执行失败，可展开后重试。', 'This step failed. Expand the flow and retry.'),
    needInput: s('需要你补充信息或确认，展开流程后继续。', 'Add the missing information or confirm, then continue.'),
    removeGroup: s('从画布删除工作流组（保留文件与运行记录）', 'Remove the workflow group from the canvas. Files and the run history stay.'),
    dragGroup: s('拖动整组', 'Drag the group'),
    syncPaused: s('状态同步中断', 'Status sync paused'),
    expand: s('展开流程', 'Expand'),
    collapse: s('收起流程', 'Collapse'),
    summary: s('流程摘要', 'Flow summary'),
    currentStep: s('当前步骤', 'Current step'),
    recentStep: s('最近完成', 'Recently finished'),
    nextStep: s('下一步', 'Next step'),
    waitingRun: s('等待执行', 'Waiting to run'),
    progress: s('工作流执行进度', 'Workflow progress'),
    stepDetail: s('步骤详情', 'Step details'),
    closeDetail: s('关闭步骤详情', 'Close step details'),
    skippedBranch: s('本次采用其他分支，此步骤未执行。', 'Another branch ran, so this step did not.'),
    viewInputs: s('查看步骤输入及关联产物。', 'View the step inputs and linked outputs.'),
    inputsFrom: s('输入来源：', 'Inputs: '),
    viewOutput: s('查看实际输出', 'View the output'),
    routeTaken: s('已采用分支：', 'Branch taken: '),
    detach: s('移出组', 'Move out'),
    attach: s('移回组', 'Move back'),
    stop: s('停止流程', 'Stop'),
    recover: s('恢复执行', 'Resume'),
    retrySave: s('重试保存', 'Retry save'),
    retryStep: s('重试此步骤', 'Retry this step'),
    items: (n: number) => s(`${n} 项`, `${n}`),
    steps: (done: number, total: number) => s(`${done} / ${total} 步`, `${done} / ${total}`),
    meter: (done: number, total: number, skipped: number) => s(
      `已完成 ${done} 步，共 ${total} 步${skipped ? `，跳过 ${skipped} 步` : ''}`,
      `${done} of ${total} steps finished${skipped ? `, ${skipped} skipped` : ''}`,
    ),
    deliveries: (artifacts: number, cards: number, skipped: number) => s(
      `${artifacts} 份产物`,
      `${artifacts} outputs`,
    ) + s(
      ` · ${cards} 张卡片${skipped > 0 ? ` · ${skipped} 步跳过` : ''}`,
      ` · ${cards} cards${skipped > 0 ? ` · ${skipped} skipped` : ''}`,
    ),
    stepTitle: (title: string, status: string) => s(`${title} · ${status}，点击查看详情`, `${title} · ${status}. Show details`),
    locate: (index: number, many: boolean) => s(many ? `定位卡片 ${index}` : '定位卡片', many ? `Find card ${index}` : 'Find card'),
  };
}
