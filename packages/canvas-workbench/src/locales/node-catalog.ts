// Canvas add-node copy. This directory is outside the hardcoded-Chinese scan.
// The host passes the active locale; omitting it keeps the historical Chinese UI.

export type CanvasNodeKind = 'image' | 'text' | 'sketch' | 'browser' | 'storyboard' | 'video' | 'page' | 'presentation';

export type CanvasNodeCopy = {
  label: string;
  description: string;
  defaultTitle: string;
};

const EN: Record<CanvasNodeKind, CanvasNodeCopy> = {
  image: { label: 'Image', description: 'Create an image component', defaultTitle: 'Image' },
  text: { label: 'Text', description: 'Start a document draft', defaultTitle: 'Text' },
  sketch: { label: 'Sketch', description: 'Draw freely. Double-click to edit', defaultTitle: 'Sketch' },
  browser: { label: 'Browser', description: 'Open a browser session. Double-click the card to enter', defaultTitle: 'Browser' },
  storyboard: { label: 'Storyboard', description: 'Arrange shots and connect image generation', defaultTitle: 'Storyboard' },
  video: { label: 'Video', description: 'Generate a video from text', defaultTitle: 'Video' },
  page: { label: 'Web page', description: 'Generate an editable HTML page', defaultTitle: 'Web page' },
  presentation: { label: 'Slides', description: 'Generate an HTML presentation', defaultTitle: 'Slides' },
};

const ZH: Record<CanvasNodeKind, CanvasNodeCopy> = {
  image: { label: '图片', description: '创建生图组件', defaultTitle: '图片' },
  text: { label: '文本', description: '创建文档草稿', defaultTitle: '文本' },
  sketch: { label: '草图', description: '自由手绘，双击进入编辑', defaultTitle: '草图' },
  browser: { label: '浏览器', description: '打开一个浏览器会话，双击卡片进入', defaultTitle: '浏览器' },
  storyboard: { label: '分镜', description: '编排镜头并连接生图', defaultTitle: '镜头脚本' },
  video: { label: '视频', description: '根据文本生成视频', defaultTitle: '视频' },
  page: { label: '网页', description: '生成可编辑 HTML 页面', defaultTitle: '网页' },
  presentation: { label: 'PPT', description: '生成 HTML 演示文稿', defaultTitle: 'PPT' },
};

export function resolveCanvasLocale(locale?: string | null): 'en' | 'zh-CN' {
  if (locale == null || locale === '') return 'zh-CN';
  return locale === 'zh-CN' || locale === 'zh-TW' || locale.startsWith('zh') ? 'zh-CN' : 'en';
}

export function canvasNodeCopy(locale?: string | null): Record<CanvasNodeKind, CanvasNodeCopy> {
  return resolveCanvasLocale(locale) === 'zh-CN' ? ZH : EN;
}

export function canvasAddNodeChrome(locale?: string | null) {
  if (resolveCanvasLocale(locale) === 'zh-CN') {
    return {
      addNode: '添加节点',
      addNodeHint: '点击添加节点，拖拽连接已有节点',
      startWorkflow: '启动工作流',
    };
  }
  return {
    addNode: 'Add node',
    addNodeHint: 'Click to add a node, or drag to connect an existing node',
    startWorkflow: 'Start a workflow',
  };
}
