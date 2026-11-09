'use client';

/**
 * 视图切换适配（DA 原生挂载版）。
 *
 * 早期画布是独立 SPA，用 `?view=` 查询参数在首页/项目/知识库/画布之间切换。
 * 平移后这些外壳视图由宿主路由承担，本包只保留画布本体，
 * 因此这里把 `goView` 降级成宿主回调：宿主想接就接（比如「返回首页」按钮
 * 回到 DA 的项目列表），不接就静默忽略。
 *
 * 保留同名同签名，使 Workbench 的调用点无需改动。
 */

export type ViewName = 'home' | 'new' | 'projects' | 'knowledge' | 'canvas';

export type ViewNavigator = (
  view: ViewName,
  extra?: Record<string, string>,
) => void;

let navigator: ViewNavigator | null = null;

/** 宿主注入真实导航实现。 */
export function setViewNavigator(next: ViewNavigator | null): void {
  navigator = next;
}

export function goView(view: ViewName, extra?: Record<string, string>): void {
  navigator?.(view, extra);
}
