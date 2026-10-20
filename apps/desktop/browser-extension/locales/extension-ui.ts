const PRODUCT_NAME = "Canvas Workspace";

export type ExtensionUiLocale = "zh-CN" | "en";

const STORAGE_KEY = "bezierExtensionLocale";

let active: ExtensionUiLocale = "zh-CN";

export function extensionUiLocale(locale: string | null | undefined): ExtensionUiLocale {
  const value = (locale ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (value === "zh" || value.startsWith("zh-")) return "zh-CN";
  return "en";
}

export function bindExtensionLocale(locale: string | null | undefined): void {
  const value = (locale ?? "").trim();
  if (!value) return;
  active = extensionUiLocale(value);
}

export function currentExtensionLocale(): ExtensionUiLocale {
  return active;
}

export function extensionLocaleStorageKey(): string {
  return STORAGE_KEY;
}

/** Browser UI language when the app has not told the extension which language to use. */
export function detectExtensionLocale(): ExtensionUiLocale {
  const chromeUi = (globalThis as { chrome?: { i18n?: { getUILanguage?: () => string } } }).chrome?.i18n?.getUILanguage?.();
  const nav = globalThis.navigator?.language;
  return extensionUiLocale(chromeUi || nav || "en");
}

function text(zh: string, en: string): string {
  return active === "zh-CN" ? zh : en;
}

export function eu() {
  return {
    disconnected: text("未连接", "Not connected"),
    connected: text("已连接", "Connected"),
    checkingShort: text("检查中", "Checking"),
    checking: text(`正在检测 ${PRODUCT_NAME}…`, `Checking ${PRODUCT_NAME}…`),
    cannotOpenApp: text(`打不开本机 ${PRODUCT_NAME}`, `Can’t reach ${PRODUCT_NAME} on this computer`),
    retry: text("重新检测", "Check again"),
    retryAria: text(`重新检测 ${PRODUCT_NAME} 连接`, `Check the ${PRODUCT_NAME} connection again`),
    popupTitle: text(`${PRODUCT_NAME} 网页采集`, `${PRODUCT_NAME} capture`),
    popupTagline: text("让灵感成为你的资产", "Turn what you find into your own assets"),
    prefsTitle: text("采集偏好", "Capture"),
    selectionTitle: text("划词保存", "Save selected text"),
    selectionHint: text("选中文字时显示保存按钮", "Show a save button when text is selected"),
    imageTitle: text("图片悬浮", "Image hover"),
    imageHint: text("悬停图片时显示保存按钮", "Show a save button when the pointer is over an image"),
    nativeDisconnected: text(`${PRODUCT_NAME} 连接已断开`, `The ${PRODUCT_NAME} connection dropped`),
    nativeUnavailable: text(`${PRODUCT_NAME} 连接不可用`, `The ${PRODUCT_NAME} connection is unavailable`),
    nativeTimeout: text(`${PRODUCT_NAME} 响应超时`, `${PRODUCT_NAME} took too long to respond`),
    nativeRecovering: text(`${PRODUCT_NAME} 连接已断开，正在自动恢复`, `The ${PRODUCT_NAME} connection dropped and is reconnecting.`),
    nativeNotRunning: text(`${PRODUCT_NAME} 未启动，正在自动检测`, `${PRODUCT_NAME} is not running. Looking for it.`),
    nativeNotResponding: text(`${PRODUCT_NAME} 暂未响应，正在自动重连`, `${PRODUCT_NAME} has not responded yet. Reconnecting.`),
    responseTooLarge: text("连接响应过大", "The connection response is too large."),
    startSignInFirst: text(`请先在 ${PRODUCT_NAME} 中发起登录连接`, `Start the sign-in connection in ${PRODUCT_NAME} first.`),
    claimInvalid: text(`连接响应无效，请在 ${PRODUCT_NAME} 重新发起`, `The connection response was invalid. Start it again in ${PRODUCT_NAME}.`),
    claimMissingToken: text(`连接响应缺少凭证，请在 ${PRODUCT_NAME} 重新发起`, `The connection response had no credential. Start it again in ${PRODUCT_NAME}.`),
    claimParseFailed: text(`连接凭证解析失败，请在 ${PRODUCT_NAME} 重新发起`, `Could not read the connection credential. Start it again in ${PRODUCT_NAME}.`),
    badAddress: text("连接地址无效", "The connection address is invalid."),
    badToken: text("连接凭证无效", "The connection credential is invalid."),
    appNotFound: text(`未找到本机 ${PRODUCT_NAME}，请先打开 ${PRODUCT_NAME}`, `Can’t find ${PRODUCT_NAME} on this computer. Open it first.`),
    badResponse: text("连接响应无效", "The connection response was invalid."),
    statusMissing: text("连接响应缺少状态", "The connection response had no status."),
    appNotReady: text(`${PRODUCT_NAME} 未就绪，请稍候`, `${PRODUCT_NAME} is not ready yet. Wait a moment.`),
    connectedLibrary: text(`已连接 ${PRODUCT_NAME} · 个人资产库`, `Connected to ${PRODUCT_NAME} · Personal library`),
    notWritable: text(`当前 ${PRODUCT_NAME} 项目不可写，未发送`, `The current ${PRODUCT_NAME} project is read-only, so nothing was sent.`),
    sendFailed: text(`发送失败，请确认 ${PRODUCT_NAME} 正在运行后重试`, `Could not send. Make sure ${PRODUCT_NAME} is running, then try again.`),
    savedToLibrary: text("已保存到资产", "Saved to your library"),
    deliveredCheckApp: text(`已送达 ${PRODUCT_NAME}，请回到 ${PRODUCT_NAME} 查看写入结果`, `Delivered to ${PRODUCT_NAME}. Go back and check the save result.`),
    sendCheckApp: text(`发送未成功，请回到 ${PRODUCT_NAME} 检查后重试`, `The send did not succeed. Check ${PRODUCT_NAME} and try again.`),
    emptyImage: text("图片内容为空", "The image is empty."),
    emptySelection: text("选区内容为空", "The selection is empty."),
    unknown: text("未知", "unknown"),
    httpImagesOnly: text("只能下载 http(s) 图片", "Only http(s) images can be downloaded."),
    downloadBlocked: text("无法下载该图（网络或站点拦截）", "Could not download this image. The network or the site blocked it."),
    yamlFailed: text("YAML 生成失败", "Could not build the YAML."),
    yamlInvalid: text("YAML 无效", "The YAML is invalid."),
    extensionUnavailable: text("插件暂不可用，请重试", "The extension is unavailable. Try again."),
    saveFailed: text("保存失败，请重试", "Could not save. Try again."),
    stashFailed: text("无法暂存图片", "Could not hold the image."),
    downloadFailed: text("下载图片失败", "Could not download the image."),
    saveSelection: text(`保存选区到 ${PRODUCT_NAME}`, `Save selection to ${PRODUCT_NAME}`),
    saveOriginal: text(`保存原图到 ${PRODUCT_NAME}`, `Save original image to ${PRODUCT_NAME}`),
    saveToApp: text(`保存到 ${PRODUCT_NAME}`, `Save to ${PRODUCT_NAME}`),
    addTag: text("添加标签", "Add tag"),
    firstTagHint: text("输入名称，创建第一个标签", "Type a name to create the first tag"),
    formMode: text("表单模式", "Form"),
    waitingForApp: text(`正在等待 ${PRODUCT_NAME}…`, `Waiting for ${PRODUCT_NAME}…`),
    defaultSpace: text("默认空间", "Default space"),
    connectedPlain: text(`已连接 ${PRODUCT_NAME}`, `Connected to ${PRODUCT_NAME}`),
    nameRequired: text("请填写名称", "Enter a name."),
    saving: text("保存中…", "Saving…"),
    saveToLibrary: text("保存到资产", "Save to library"),
    selectTextFirst: text("请先在页面中选中一段文字", "Select some text on the page first."),
    saveImageToApp: text(`保存图片到 ${PRODUCT_NAME}`, `Save image to ${PRODUCT_NAME}`),
    imageUrlMissing: text("未识别到图片地址", "Could not find an image address."),
    noPendingImage: text("没有待保存的图片", "There is no image waiting to be saved."),
    saveImageToLibrary: text("保存图片到资产", "Save image to library"),
    webOriginal: text("网页原图", "Original web image"),
    pendingImage: text("待保存的图片", "Image waiting to be saved"),
    extensionCannotDownload: text("扩展无法下载该图", "The extension could not download this image."),
    imageNotLoaded: text("图片尚未加载完成", "The image has not finished loading."),
    cannotReadFrame: text("无法读取画面", "Could not read the picture."),
    cannotExportFrame: text("无法导出画面", "Could not export the picture."),
    crossOriginBlocked: text("页面不允许读取该图（跨域保护）", "The page does not allow reading this image (cross-origin protection)."),
    anonymousLoadFailed: text("匿名跨域加载失败", "Anonymous cross-origin loading failed."),
    localImageFailed: text("本地图读取失败", "Could not read the local image."),
    extensionDownloadFailed: text("扩展下载失败", "The extension download failed."),
    pageDownloadFailed: text("页面下载失败", "The page download failed."),
    canvasCrossOriginFailed: text("跨域画布失败", "The cross-origin canvas failed."),
    frameExportFailed: text("画面导出失败", "Exporting the picture failed."),
    cannotDownloadImage: text("无法下载该图", "Could not download this image."),
    webSelection: text("网页选区", "Web selection"),
    refreshPage: text("插件已更新，请刷新这个页面后再保存", "The extension was updated. Refresh this page, then save."),
    originalFailed: text("原图获取失败", "Could not get the original image."),
    close: text("关闭", "Close"),
    space: text("所属空间", "Space"),
    name: text("名称", "Name"),
    tags: text("标签", "Tags"),
    tagSearch: text("搜索或创建标签…", "Search or create a tag…"),
    enterAdd: text("Enter 添加", "Enter to add"),
    escClose: text("Esc 关闭", "Esc to close"),
    description: text("描述", "Description"),
    descriptionPlaceholder: text("记录内容亮点，方便下次找到…", "Note what stands out, so you can find it later…"),
    moreInfo: text("更多信息", "More"),
    style: text("风格", "Style"),
    stylePlaceholder: text("语气、结构、表达方式…", "Tone, structure, wording…"),
    usage: text("使用场景", "Use"),
    usagePlaceholder: text("适合用在哪里…", "Where this fits…"),
    rating: text("评分", "Rating"),
    ratingAria: text("资产评分", "Asset rating"),
    fileInfo: text("文件信息", "File info"),
    dimensions: text("尺寸", "Dimensions"),
    kind: text("类型", "Type"),
    imageKind: text("图片", "Image"),
    size: text("大小", "Size"),
    addedAt: text("添加时间", "Added"),
    imageColors: text("图片颜色", "Image colors"),
    viewSource: text("查看原始来源", "View source"),
    aiFill: text("AI 补全", "AI fill"),
    cancel: text("取消", "Cancel"),
    connecting: text(`正在连接 ${PRODUCT_NAME}…`, `Connecting to ${PRODUCT_NAME}…`),
    projectReadOnly(name: string): string {
      return text(`当前项目「${name}」为只读，无法保存`, `“${name}” is read-only, so it can’t be saved.`);
    },
    connectedProject(name: string): string {
      return text(`已连接 ${PRODUCT_NAME} · ${name}`, `Connected to ${PRODUCT_NAME} · ${name}`);
    },
    imageResponse(status: number): string {
      return text(`图片响应 ${status}`, `Image response ${status}`);
    },
    unsupportedImage(mime: string): string {
      const label = mime || text("未知", "unknown");
      return text(`不支持的图片类型 ${label}`, `Unsupported image type ${label}`);
    },
    removeTag(tag: string): string {
      return text(`移除标签 ${tag}`, `Remove tag ${tag}`);
    },
    createTag(name: string): string {
      return text(`新增「${name}」`, `Create “${name}”`);
    },
    originalFailedDetail(message: string): string {
      return text(`原图获取失败：${message}`, `Could not get the original image: ${message}`);
    },
    imageTooLarge: text("图片超过 25 MiB 上限", "The image is over the 25 MiB limit."),
    deliveredUnconfirmed: text(`已送达 ${PRODUCT_NAME}，保存结果尚未确认，请回到 ${PRODUCT_NAME} 查看`, `Delivered to ${PRODUCT_NAME}. The save is not confirmed yet. Check ${PRODUCT_NAME}.`),
    inspectorExpired: text(`资产连接已过期，请回到 ${PRODUCT_NAME} 查看已保存资产`, `The asset connection expired. Open ${PRODUCT_NAME} to see the saved asset.`),
    assetActionInvalid: text("资产操作无效", "That asset action is not valid"),
    connectFailed: text(`连接 ${PRODUCT_NAME} 失败，请重试`, `Could not reach ${PRODUCT_NAME}. Try again.`),
    yamlInvalidShort: text("YAML 无效", "The YAML is not valid"),
    yamlBuildFailed: text("YAML 生成失败", "Could not build the YAML"),
    promptPlaceholder: text("提取后将在这里显示创作 Prompt。", "The extracted prompt will appear here."),
    promptQueued: text("排队中，等待 AI 提取…", "Queued for extraction…"),
    promptExtracting: text("正在提取，完成后自动保存…", "Extracting. It will be saved when finished…"),
    promptFailed: text("提取失败，请重试。", "Extraction failed. Try again."),
    promptSaved: text(`已自动保存到 ${PRODUCT_NAME} 资产`, `Saved to ${PRODUCT_NAME} assets`),
    promptHint: text("基于实际内容，提取内容、视觉语言与约束。", "Extracted from the real content: subject, visual language, and constraints."),
    extracting: text("提取中…", "Extracting…"),
    analyzing: text("分析中…", "Analyzing…"),
    extractAgain: text("重新提取", "Extract again"),
    extractPrompt: text("提取 Prompt", "Extract prompt"),
    analyzeAgain: text("重新分析", "Analyze again"),
    analysisFailed: text("信息分析失败，请重新分析", "Analysis failed. Try again."),
    saveEdits: text("保存修改", "Save changes"),
    connectionDropped: text(`${PRODUCT_NAME} 连接中断，请重试`, `${PRODUCT_NAME} disconnected. Try again.`),
    readFailed: text("读取失败", "Could not read"),
    savedUpdateApp: text(`资产已保存，请回到 ${PRODUCT_NAME} 查看，或更新 ${PRODUCT_NAME} 桌面端后重试。`, `The asset was saved. Open ${PRODUCT_NAME}, or update the desktop app and try again.`),
    saveFailedRetry: text("保存失败，请重试", "Could not save. Try again."),
    savedNeedUpdate: text(`资产已保存。请更新 ${PRODUCT_NAME} 桌面端后使用 Prompt 提取。`, `The asset was saved. Update the ${PRODUCT_NAME} desktop app to extract a prompt.`),
    savedToAssets: text(`已保存到 ${PRODUCT_NAME} 资产`, `Saved to ${PRODUCT_NAME} assets`),
    actionFailed: text("操作失败，请重试", "The action failed. Try again."),
    panelOpened: text("已打开采集面板", "The capture panel is open"),
    creationPrompt: text("创作 Prompt", "Prompt"),
    copy: text("复制", "Copy"),
    saveAndExtract: text("保存并提取", "Save and extract"),
    assetYaml: text("资产 YAML", "Asset YAML"),
    reconnect: text("重新连接", "Reconnect"),
    star(n: number): string {
      return text(`评分 ${n} 星`, `Rate ${n} star${n === 1 ? "" : "s"}`);
    },
  };
}

/** Native hosts can keep an older app locale while the browser has already switched. */
export function localizeBridgeError(raw: string, fallback: string): string {
  const copy = eu();
  if (/连接响应过大|connection response is too large/i.test(raw)) return copy.responseTooLarge;
  if (/连接响应无效|connection response is invalid/i.test(raw)) return copy.badResponse;
  if (/连接已断开|connection dropped/i.test(raw)) return copy.nativeRecovering;
  if (/未启动|is not running/i.test(raw)) return copy.nativeNotRunning;
  if (/暂未响应|has not responded/i.test(raw)) return copy.nativeNotResponding;
  if (/请求无效|request is invalid/i.test(raw)) return copy.badResponse;
  if (/连接不可用|connection is unavailable/i.test(raw)) return copy.nativeUnavailable;
  if (/请先在 (?:DA|Loom) 中发起登录连接|Start the sign-in connection/i.test(raw)) return copy.startSignInFirst;
  if (/连接暂不可用|connection expired|连接已过期/i.test(raw)) return copy.nativeUnavailable;
  // Preserve an unknown diagnostic only when it is readable in the selected UI locale.
  const hasChinese = /[\u3400-\u9fff]/u.test(raw);
  const matchesLocale = currentExtensionLocale() === "en" ? !hasChinese : hasChinese;
  return matchesLocale ? raw : fallback;
}
