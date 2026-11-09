// Shared canvas chrome. This directory is outside the hardcoded-Chinese scan.
// The host passes the active locale; omitting it keeps the historical Chinese UI.

import { resolveCanvasLocale } from './node-catalog';

export function canvasNodeActionChrome(locale?: string | null) {
  if (resolveCanvasLocale(locale) === 'zh-CN') {
    return {
      group: '卡片操作',
      duplicateNode: '复制节点',
      removeNode: '删除节点',
      duplicate: '复制',
      remove: '删除',
      download: '下载',
      removeFromGroup: '移出分组',
    };
  }
  return {
    group: 'Card actions',
    duplicateNode: 'Duplicate node',
    removeNode: 'Delete node',
    duplicate: 'Duplicate',
    remove: 'Delete',
    download: 'Download',
    removeFromGroup: 'Remove from group',
  };
}

export function canvasSelectionChrome(locale?: string | null) {
  if (resolveCanvasLocale(locale) === 'zh-CN') {
    return {
      actions: '分组操作',
      group: '打组',
      moveIntoGroup: '移入分组',
      removeFromGroup: '移出分组',
      clear: '取消选择',
      selected: (count: number) => `已选 ${count} 项`,
    };
  }
  return {
    actions: 'Group actions',
    group: 'Group',
    moveIntoGroup: 'Move into group',
    removeFromGroup: 'Remove from group',
    clear: 'Clear selection',
    selected: (count: number) => `${count} selected`,
  };
}

const EDITOR_TOOLS = ['select', 'rectangle', 'ellipse', 'arrow', 'line', 'brush', 'text', 'tag', 'mosaic'] as const;
export type ImageEditorToolId = (typeof EDITOR_TOOLS)[number];

type EditorStrings = {
  tools: Record<ImageEditorToolId, { label: string; tooltip: string }>;
  colors: Record<string, string>;
  loadFailed: string;
  notReady: string;
  unsupported: string;
  exportFailed: string;
  saveFailed: string;
  regenerateFailed: string;
  toolbar: string;
  undo: string;
  undoTip: string;
  redo: string;
  redoTip: string;
  clear: string;
  clearTip: string;
  cancel: string;
  cancelTip: string;
  save: string;
  saveTip: string;
  regenerate: string;
  regenerateTip: string;
  plain: string;
  filled: string;
  outlined: string;
  fontSize: string;
  fontSizeValue: (size: number) => string;
  mosaic: string;
  blur: string;
  brushPaint: string;
  brushSize: string;
  brushSizeValue: (size: number) => string;
  rectangleSelect: string;
  blurStrength: string;
  mosaicStrength: string;
  strokeWidth: string;
  canvasLabel: (name: string) => string;
  inputTag: string;
  inputText: string;
};

const EDITOR_ZH: EditorStrings = {
  tools: {
    select: { label: '选择', tooltip: '选择、移动或缩放已有标注' },
    rectangle: { label: '矩形', tooltip: '拖拽绘制矩形' },
    ellipse: { label: '椭圆', tooltip: '拖拽绘制椭圆' },
    arrow: { label: '箭头', tooltip: '拖拽绘制指向箭头' },
    line: { label: '直线', tooltip: '拖拽绘制直线' },
    brush: { label: '画笔', tooltip: '自由绘制线条' },
    text: { label: '文字', tooltip: '点击图片添加文字；双击可编辑' },
    tag: { label: '标签', tooltip: '拖拽确定标签方向' },
    mosaic: { label: '马赛克', tooltip: '局部打码或模糊' },
  },
  colors: {
    '#FF3B30': '红色', '#FF9500': '橙色', '#FFCC00': '黄色', '#34C759': '绿色',
    '#007AFF': '蓝色', '#AF52DE': '紫色', '#1C1C1E': '黑色', '#FFFFFF': '白色',
  },
  loadFailed: '图片读取失败，无法进入标注',
  notReady: '标注图片尚未准备好',
  unsupported: '浏览器不支持图片标注',
  exportFailed: '标注结果导出失败',
  saveFailed: '标注结果保存失败',
  regenerateFailed: '按标注改图提交失败',
  toolbar: '图片标注工具栏',
  undo: '撤销',
  undoTip: '撤销上一步（⌘Z）',
  redo: '重做',
  redoTip: '重做（⇧⌘Z）',
  clear: '清空',
  clearTip: '清空全部标注',
  cancel: '取消',
  cancelTip: '退出且不保存',
  save: '保存',
  saveTip: '保存为新图片',
  regenerate: '按标注改图',
  regenerateTip: '以当前标注图为唯一参考重新生图',
  plain: '普通文本',
  filled: '填充文本',
  outlined: '描边文本',
  fontSize: '字号',
  fontSizeValue: (size) => `字号 ${size}pt`,
  mosaic: '马赛克',
  blur: '模糊',
  brushPaint: '笔刷涂抹',
  brushSize: '笔刷粗细',
  brushSizeValue: (size) => `笔刷粗细 ${size}px`,
  rectangleSelect: '矩形选区',
  blurStrength: '模糊强度',
  mosaicStrength: '马赛克强度',
  strokeWidth: '线宽',
  canvasLabel: (name) => `${name} 标注画布`,
  inputTag: '输入标签',
  inputText: '输入文字',
};

const EDITOR_EN: EditorStrings = {
  tools: {
    select: { label: 'Select', tooltip: 'Select, move, or resize existing marks' },
    rectangle: { label: 'Rectangle', tooltip: 'Drag to draw a rectangle' },
    ellipse: { label: 'Ellipse', tooltip: 'Drag to draw an ellipse' },
    arrow: { label: 'Arrow', tooltip: 'Drag to draw an arrow' },
    line: { label: 'Line', tooltip: 'Drag to draw a line' },
    brush: { label: 'Brush', tooltip: 'Draw freehand' },
    text: { label: 'Text', tooltip: 'Click the image to add text. Double-click to edit' },
    tag: { label: 'Tag', tooltip: 'Drag to set the tag direction' },
    mosaic: { label: 'Mosaic', tooltip: 'Pixelate or blur part of the image' },
  },
  colors: {
    '#FF3B30': 'Red', '#FF9500': 'Orange', '#FFCC00': 'Yellow', '#34C759': 'Green',
    '#007AFF': 'Blue', '#AF52DE': 'Purple', '#1C1C1E': 'Black', '#FFFFFF': 'White',
  },
  loadFailed: 'Could not read the image, so annotation is unavailable.',
  notReady: 'The image is not ready to annotate.',
  unsupported: 'This browser cannot annotate images.',
  exportFailed: 'Could not export the annotation.',
  saveFailed: 'Could not save the annotation.',
  regenerateFailed: 'Could not submit the annotated edit.',
  toolbar: 'Image annotation',
  undo: 'Undo',
  undoTip: 'Undo (⌘Z)',
  redo: 'Redo',
  redoTip: 'Redo (⇧⌘Z)',
  clear: 'Clear',
  clearTip: 'Clear all marks',
  cancel: 'Cancel',
  cancelTip: 'Exit without saving',
  save: 'Save',
  saveTip: 'Save as a new image',
  regenerate: 'Edit from marks',
  regenerateTip: 'Regenerate using this marked image as the only reference',
  plain: 'Plain text',
  filled: 'Filled text',
  outlined: 'Outlined text',
  fontSize: 'Font size',
  fontSizeValue: (size) => `Font size ${size}pt`,
  mosaic: 'Mosaic',
  blur: 'Blur',
  brushPaint: 'Brush',
  brushSize: 'Brush size',
  brushSizeValue: (size) => `Brush size ${size}px`,
  rectangleSelect: 'Rectangle selection',
  blurStrength: 'Blur strength',
  mosaicStrength: 'Mosaic strength',
  strokeWidth: 'Stroke',
  canvasLabel: (name) => `${name} annotation canvas`,
  inputTag: 'Enter tag',
  inputText: 'Enter text',
};

export function imageEditorCopy(locale?: string | null): EditorStrings {
  return resolveCanvasLocale(locale) === 'zh-CN' ? EDITOR_ZH : EDITOR_EN;
}

export const IMAGE_EDITOR_TOOL_IDS = EDITOR_TOOLS;
