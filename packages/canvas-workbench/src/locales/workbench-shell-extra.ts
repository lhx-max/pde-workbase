import type { CopyShape } from './copy-shape';
import { resolveCanvasLocale } from './node-catalog';

export function workbenchShellExtra(locale?: string | null) {
  if (resolveCanvasLocale(locale) === 'zh-CN') return ZH;
  return EN;
}

const EN = {
  generatingVersionKeep: 'Generating a new version. Original kept…',
  subjectSubmitting: 'This subject is submitting. Please wait.',
  subjectHasJob: 'This subject already has a generation job. Wait for it to finish.',
  jobNotCreated: 'Generation job was not created. Try again.',
  genFailedRetry: 'Generation failed. Try again.',
  imageCannotRetry: 'This image cannot be retried',
  submittedNewJob: 'Submitted a new generation job',
  visualCardMissing: 'Could not find the parent visual card',
  imageRetryFailed: 'Image retry failed',
  noCutoutFile: 'This image has no project file available for cutout',
  cutoutInProgress: 'Cutout is in progress',
  keepSubjectTransparent: 'Keep subject, transparent background',
  transparentCutout: 'Transparent cutout',
  cutoutPendingRight: 'Cutting out… a transparent asset will appear on the right when done',
  readWithReadTool: 'Read it directly with the Read tool',
  viewWithReadTool: 'View the image directly with the Read tool',
  readDocViaTextutil: 'Read cannot open binaries. Use Bash: textutil -convert txt -stdout "path"',
  readXlsxHint:
    'Read cannot open binaries. Use Bash: python3 -c \'import openpyxl,sys;[print("\\t".join("" if c.value is None else str(c.value) for c in r)) for ws in openpyxl.load_workbook(sys.argv[1],data_only=True) for r in ws.iter_rows()]\' "path"',
  readPdfHint:
    'Read cannot open binaries. Use Bash: uv run --with pypdf python -c \'import sys,pypdf;print("\\n".join(p.extract_text() or "" for p in pypdf.PdfReader(sys.argv[1]).pages))\' "path"',
  pleaseRetry: 'Try again',
  loadingClip: 'Loading the clip. If the node was deleted, return to the canvas.',
  backToCanvas: 'Back to canvas',
  tidyByFlow: 'Organize by flow',
  tidyByFlowHint: 'Preserve upstream/downstream links and image lineage',
  tidyByTask: 'Organize by task type',
  tidyByTaskHint: 'Group plan, image, slides, web, and video',
  restoreLayout: 'Restore layout',
  restoreLayoutHint: 'Return to positions from before organize',
  canvasSettings: 'Canvas settings',
  backgroundStyle: 'Background style',
  backgroundColor: 'Background color',
  cutoutSuffixDot: (base: string) => `${base} · Cutout`,
  generatingWorkflowTitle: (title: string) => `Generating ${title}…`,
  genFailedDetail: (detail: string) => `Generation failed: ${detail}`,
} as const;

const ZH = {
  generatingVersionKeep: '正在生成新版本，原图保留…',
  subjectSubmitting: '该主体正在提交，请稍候',
  subjectHasJob: '该主体已有生成任务，请等待完成',
  jobNotCreated: '生成任务未创建，请重试',
  genFailedRetry: '生成失败，请重试',
  imageCannotRetry: '该图片无法重试',
  submittedNewJob: '已提交新的生成任务',
  visualCardMissing: '找不到所属视觉卡',
  imageRetryFailed: '图片重试失败',
  noCutoutFile: '该图片还没有可供抠图的项目文件',
  cutoutInProgress: '抠图任务正在处理中',
  keepSubjectTransparent: '保留主体，透明背景',
  transparentCutout: '透明抠图',
  cutoutPendingRight: '正在抠图，完成后会在右侧新增透明素材',
  readWithReadTool: '用 Read 工具直接读',
  viewWithReadTool: '用 Read 工具直接看图',
  readDocViaTextutil: 'Read 读不了二进制，用 Bash 执行 textutil -convert txt -stdout "路径"',
  readXlsxHint:
    'Read 读不了二进制，用 Bash 执行 python3 -c \'import openpyxl,sys;[print("\\t".join("" if c.value is None else str(c.value) for c in r)) for ws in openpyxl.load_workbook(sys.argv[1],data_only=True) for r in ws.iter_rows()]\' "路径"',
  readPdfHint:
    'Read 读不了二进制，用 Bash 执行 uv run --with pypdf python -c \'import sys,pypdf;print("\\n".join(p.extract_text() or "" for p in pypdf.PdfReader(sys.argv[1]).pages))\' "路径"',
  pleaseRetry: '请重试',
  loadingClip: '正在载入剪辑；如果节点已删除，请返回画布。',
  backToCanvas: '返回画布',
  tidyByFlow: '按流程整理',
  tidyByFlowHint: '保护上下游关系与图片血缘',
  tidyByTask: '按任务类型整理',
  tidyByTaskHint: '按策划、生图、PPT、网页和视频分区',
  restoreLayout: '还原布局',
  restoreLayoutHint: '恢复整理前的位置',
  canvasSettings: '画布设置',
  backgroundStyle: '背景样式',
  backgroundColor: '背景颜色',
  cutoutSuffixDot: (base: string) => `${base} · 抠图`,
  generatingWorkflowTitle: (title: string) => `正在生成${title}…`,
  genFailedDetail: (detail: string) => `生成失败：${detail}`,
} satisfies CopyShape<typeof EN>;
