import { currentDesktopLocale } from './desktop-ui.js';

/** First-party native diagnostics; protocol error codes and untrusted page content stay unchanged. */
const messages = {
  'Cancelled.': '已取消。',
  'Native host authorization required': '需要桌面宿主授权。',
  'Unknown native command': '未知桌面宿主指令。',
  'JSON command required': '需要 JSON 格式的指令。',
  'Native command exceeds limit': '桌面宿主指令超过大小限制。',
  'Native resource command failed': '桌面资源指令执行失败。',
  'The trusted application document is unavailable': '受信任的应用页面不可用。',
  'Owned browser guest required': '需要由当前窗口管理的浏览器页面。',
  'Application document changed': '应用页面已改变，请重试。',
  'Application document changed.': '应用页面已改变，请重试。',
  'Only HTTP(S) external URLs are supported': '仅支持 HTTP(S) 外部链接。',
  'Capture document changed or image is empty': '采集页面已改变或图片为空。',
  'Capture session changed.': '采集会话已改变。',
  'Capture receiver is unavailable or busy.': '采集接收服务不可用或正忙。',
  'Delivered; check the asset library for the persisted result.': '内容已送达，请到资产库确认保存结果。',
  'Capture intent or session is unavailable.': '采集操作或会话不可用。',
  'Capture session expired.': '采集会话已过期。',
  'Invalid inspector request.': '资产检查请求无效。',
  'Discovery unavailable.': '扩展发现服务不可用。',
  'Invalid capture context': '采集上下文无效。',
  'Local browser capture bridge unavailable': '本机浏览器采集连接不可用。',
  'Image response is unavailable': '图片响应不可用。',
  'Unsupported image format; no screenshot substitution': '不支持此图片格式，未使用截图替代。',
  'Empty image resource': '图片资源为空。',
  'Image exceeds 25 MiB': '图片超过 25 MiB 上限。',
  'Image signature does not match its MIME type': '图片内容特征与 MIME 类型不匹配。',
  'Only HTTP(S) image URLs are supported': '仅支持 HTTP(S) 图片地址。',
  'Only HTTP(S) URLs without credentials are supported': '仅支持不含凭证的 HTTP(S) 地址。',
  'Image source is no longer available': '图片来源已不可用。',
  'Invalid browser guest': '浏览器页面无效。',
  'Image collector is unavailable': '图片采集器不可用。',
  'Image source document changed': '图片来源页面已改变。',
  'Image read timed out': '读取图片超时。',
  'Image is not in the current document': '图片不在当前页面中。',
  'Resource capture changed': '资源采集会话已改变。',
  'Resource grants require the trusted main window frame': '资源授权需要受信任的主窗口页面。',
  'Resource grant is unavailable': '资源授权不可用。',
  'Resource grant expired or closed': '资源授权已过期或关闭。',
  'Too many resource operations': '资源操作过多，请稍后重试。',
  'Resource document changed': '资源来源页面已改变。',
  'Resource operation timed out': '资源操作超时。',
  'Resource operation failed': '资源操作失败。',
  'Invalid resource grant': '资源授权无效。',
  'Browser guest is not owned by this window': '此浏览器页面不属于当前窗口。',
  'Resource grant limit reached': '资源授权数量已达上限。',
  'Resource capture is disabled': '资源采集已停用。',
  'Invalid resource command': '资源指令无效。',
  'Resource is no longer observed': '资源已不在当前采集范围内。',
  'Resource is metadata-only': '此资源仅提供元数据，无法读取内容。',
  'Resource response unavailable': '资源响应不可用。',
  'Resource MIME does not match': '资源 MIME 类型不匹配。',
  'Resource exceeds 25 MiB': '资源超过 25 MiB 上限。',
  'Resource body unavailable': '资源内容不可用。',
  'Resource signature is unsupported': '不支持此资源内容特征。',
  'Invalid capture clip': '截图区域无效。',
  'Capture clip is outside the window': '截图区域超出窗口范围。',
} as const;

export function nativeMessage(message: keyof typeof messages): string {
  return currentDesktopLocale() === 'en' ? message : messages[message];
}

/** Do not display raw platform/network English diagnostics in the Chinese UI. */
export function nativeFailure(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : '';
  if (Object.hasOwn(messages, raw)) return nativeMessage(raw as keyof typeof messages);
  const hasChinese = /[\u3400-\u9fff]/u.test(raw);
  return raw && (currentDesktopLocale() === 'en' ? !hasChinese : hasChinese) ? raw : fallback;
}
