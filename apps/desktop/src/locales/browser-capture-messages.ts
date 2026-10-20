export function captureMessages(locale = "en") {
  const zh = locale.toLowerCase().startsWith("zh");
  const s = (cn: string, en: string) => (zh ? cn : en);
  const product = "Canvas Workspace";
  return {
    invalid: s("资产操作无效", "That asset action is not valid"),
    expired: s(`资产连接已过期，请回到 ${product} 查看已保存资产`, `The asset connection expired. Open ${product} to see the saved asset.`),
    unsupported: s("不支持此资产操作", "That asset action is not supported"),
    badPatch: s("资产修改无效", "That asset edit is not valid"),
    badFields: s("资产修改字段或版本无效", "The asset fields or revision are not valid"),
    tooLarge: s("内容超过单次采集上限", "The capture is over the size limit"),
    claimExpired: s("连接已过期", "The connection expired"),
    updateApp: s(`请更新 ${product} 桌面端以使用资产检查器`, `Update the ${product} desktop app to use the asset inspector`),
    receiveFailed: s(`接收失败，请回到 ${product} 重新发送`, `Could not receive the capture. Send it again from ${product}.`),
    unavailable: s(`${product} 当前不可用`, `${product} is not available`),
    timeout: s(`${product} 响应超时，请重试读取状态`, `${product} timed out. Read the status again.`),
    actionFailed: s("资产操作失败", "The asset action failed"),
    windowClosed: s(`${product} 窗口已关闭`, `The ${product} window is closed`),
    saved: s("已保存", "Saved"),
    notSaved: s("未保存", "Not saved"),
  };
}
