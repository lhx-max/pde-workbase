const PRODUCT_NAME = "Canvas Workspace";

export type DesktopUiLocale = "zh-CN" | "en";

let active: DesktopUiLocale = "zh-CN";

/** Chinese UI, including zh-TW, stays zh-CN. Every other tag uses English. */
export function desktopUiLocale(locale: string | null | undefined): DesktopUiLocale {
  const value = (locale ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (value === "zh" || value.startsWith("zh-")) return "zh-CN";
  return "en";
}

/** Empty input leaves the current locale alone so a missing host value cannot flip the UI. */
export function bindDesktopLocale(locale: string | null | undefined): void {
  const value = (locale ?? "").trim();
  if (!value) return;
  active = desktopUiLocale(value);
}

export function currentDesktopLocale(): DesktopUiLocale {
  return active;
}

/** Line 1 is the locale. Line 2 is the English product name. Hosts read this on each error. */
export function nativeHostLocaleFileBody(): string {
  const name = PRODUCT_NAME.replace(/[\r\n]/g, " ").trim() || "Loom";
  return `${currentDesktopLocale()}\n${name}\n`;
}

function text(zh: string, en: string): string {
  return active === "zh-CN" ? zh : en;
}

/** On-disk package name. Both languages show this filename because that is the file the user drags. */
export const EXTENSION_PACKAGE_NAME = "Loom网页采集.zip";

export function du() {
  return {
    cancel: text("取消", "Cancel"),
    firstInstall: text("首次安装", "First-time install"),
    alreadyInstalledContinue: text("已安装，继续", "Already installed, continue"),
    later: text("稍后再说", "Not now"),
    alreadyInstalledConnect: text("已安装，继续连接", "Already installed, keep connecting"),
    stayInApp: text("留在 DA", `Stay in ${PRODUCT_NAME}`),
    openOriginalSite: text("打开原网站", "Open the original site"),
    saved: text("已保存", "Saved"),
    notSaved: text("未保存", "Not saved"),
    browser: text("浏览器", "Browser"),
    pinterestCanceled: text("已取消登录连接，外部浏览器中的账号不受影响", "Sign-in connection canceled. The account in your external browser is unchanged."),
    devOnlySignIn: text("仅供本机开发验证，不是正式登录支持", "For local development checks only. This is not a supported sign-in path."),
    macOnlyConnect: text("自动连接目前仅在 macOS 开发版验证", "Automatic connection is only verified in the macOS development build."),
    openPinterestFirst: text("请先在内置浏览器打开 Pinterest", "Open Pinterest in the built-in browser first."),
    signInAlreadyRunning: text("已有登录连接进行中，请先完成或取消", "A sign-in connection is already in progress. Finish or cancel it first."),
    defaultBrowserCannotContinue: text("默认浏览器暂不支持登录接续", "The default browser cannot continue this sign-in yet."),
    pinterestOpenDetail: text(
      "可以在默认浏览器打开 Pinterest，但登录状态不会自动返回 DA。不会替你切换到 Chrome，也不会读取浏览器配置。",
      `You can open Pinterest in the default browser, but the sign-in state will not return to ${PRODUCT_NAME}. This will not switch you to Chrome or read the browser profile.`,
    ),
    connectorFolderFailed: text("连接器文件夹无法打开", "Could not open the connector folder."),
    sourceChanged: text("已取消或来源页面已改变，请从原页面重新发起", "Canceled, or the source page changed. Start again from the original page."),
    connectingPinterest: text("正在接入 Pinterest 会话…", "Connecting the Pinterest session…"),
    sessionConnectFailed: text("会话接入失败", "Could not connect the session."),
    sessionConnected: text(
      "会话已接入，已返回采集页。请确认页面显示的是你的 Pinterest 账号。",
      "Session connected. You are back on the capture page. Confirm it shows your Pinterest account.",
    ),
    signInTimedOut: text("登录连接已超时，请重新发起；原有浏览数据不受影响", "The sign-in connection timed out. Start it again. Existing browsing data is unchanged."),
    defaultBrowserStartFailed: text(
      "默认浏览器连接启动失败，请检查默认浏览器和 DA 连接器后重试。",
      `Could not start the default-browser connection. Check the default browser and the ${PRODUCT_NAME} connector, then try again.`,
    ),
    unknownSignInSite: text("无法确认发起登录的网站，请返回原网站后重新点击 Google 登录。", "Could not tell which site started sign-in. Return to that site and click Google sign-in again."),
    connectionDidNotStart: text("连接未启动", "The connection did not start."),
    continueSignInTitle: text("在默认浏览器继续登录", "Continue sign-in in the default browser"),
    siteCannotReturnDetail: text(
      "此网站尚未适配登录状态返回 DA。可以在默认浏览器重新发起登录；DA 保留当前采集页，不会读取该网站的登录凭证，也不会显示已接续。",
      `This site cannot return sign-in state to ${PRODUCT_NAME} yet. You can start sign-in again in the default browser. ${PRODUCT_NAME} keeps the current capture page, does not read that site's credentials, and will not show the session as connected.`,
    ),
    openedOriginalSite: text("已打开原网站；此站点暂不支持登录状态返回 DA。", `Opened the original site. This site cannot return sign-in state to ${PRODUCT_NAME} yet.`),
    sourceChangedNoLogin: text("来源页面已改变，未打开登录。请在当前页面重新发起。", "The source page changed, so sign-in was not opened. Start again on the current page."),
    stayedInApp: text("已留在 DA；此站点暂不支持登录状态接回，可继续浏览公开素材。", `Stayed in ${PRODUCT_NAME}. This site cannot return sign-in state yet. You can keep browsing public material.`),
    couldNotOpenSignIn: text("无法打开登录，请稍后重试。", "Could not open sign-in. Try again later."),
    captureBrowserClosed: text("采集浏览器已关闭", "The capture browser is closed."),
    webImageOnly: text("仅支持网页图片资源", "Only web image resources are supported."),
    imageNotOnPage: text("图片不在当前网页中，请重新拖动或右键", "That image is not on the current page. Drag it again or use the context menu."),
    resourceSaveFailed: text("资源保存失败", "Could not save the resource."),
    extensionTalking: text("插件正在与本机 DA 通信", `The extension is talking to ${PRODUCT_NAME} on this computer.`),
    extensionMissing: text(
      "未检测到插件。装在 Chrome / Edge / Brave 任一浏览器都会自动连上本机 DA",
      `No extension detected. Install it in Chrome, Edge, or Brave and it will connect to ${PRODUCT_NAME} on this computer.`,
    ),
    windowClosed: text("DA 窗口已关闭", `The ${PRODUCT_NAME} window is closed.`),
    deliveredWaiting: text("已送达 DA，正在等待写入结果", `Delivered to ${PRODUCT_NAME}. Waiting for the save result.`),
    discoveryUnavailable: text("浏览器插件发现服务暂不可用，正在自动重试", "Extension discovery is unavailable. Retrying automatically."),
    noSupportedBrowser: text(
      "未检测到支持的浏览器（Chrome / Edge / Chromium / Brave），无法注册连接",
      "No supported browser was found (Chrome, Edge, Chromium, or Brave), so the connection could not be registered.",
    ),
    extensionConnected: text("浏览器插件已连接，可以发送选区", "The browser extension is connected. You can send a selection."),
    extensionReady: text("浏览器插件连接已就绪", "The browser extension connection is ready."),
    extensionConnectionRetrying: text("浏览器插件连接暂不可用，正在自动重试", "The browser extension connection is unavailable. Retrying automatically."),
    unknownDefaultBrowser: text("无法识别默认浏览器", "Could not identify the default browser."),
    connectBrowser: text("连接浏览器", "Connect browser"),
    claimExpiredOrUsed: text("连接已过期或已使用，请重新发送", "This connection expired or was already used. Send it again."),
    badRequestFormat: text("请求格式错误", "The request format is invalid."),
    payloadTooLarge: text("内容超过单次采集上限", "The content is over the capture limit."),
    connectionExpired: text("连接已过期", "This connection has expired."),
    badContentFormat: text("内容格式错误", "The content format is invalid."),
    receiveFailed: text("接收失败，请回到 DA 重新发送", `Could not receive it. Return to ${PRODUCT_NAME} and send it again.`),
    imageNotInJson: text("图片不要放进 JSON，请发送原图字节", "Do not put the image in JSON. Send the original image bytes."),
    imageChannelOnly: text("原图通道只接受 image 采集", "The original-image channel only accepts image captures."),
    discoveryPortBusy: text("无法占用本机发现端口", "Could not bind the local discovery port."),
    localExtensionOnly: text("只接受本机浏览器插件", "Only a browser extension on this computer is accepted."),
    connectionUnavailable: text("连接暂不可用，请重试", "The connection is unavailable. Try again."),
    unknownRequest: text("未知请求", "Unknown request."),
    captureStopped: text("DA 已停止浏览器采集", `${PRODUCT_NAME} stopped browser capture.`),
    invalidRequest: text("请求无效", "The request is invalid."),
    connectorInstallDetail: text(
      "扩展管理页和连接器文件夹已打开。请启用开发者模式，选择“加载解压缩的扩展”，选中该文件夹。已有旧版请点“重新加载”。安装完成后继续；DA 会验证实际连接，不会把点击继续当作安装成功。正式版需商店发布后才能提供商店安装。",
      `The extensions page and the connector folder are open. Turn on developer mode, choose “Load unpacked”, and select that folder. If an older copy is installed, click “Reload”. Continue after installation. ${PRODUCT_NAME} checks the real connection and does not treat clicking continue as success. A store install is available only after a store release.`,
    ),
    extensionDirMissing: text("还没有打出插件目录，请先构建浏览器插件", "The extension directory has not been built. Build the browser extension first."),
    packageFailed: text("插件打包失败", "Could not package the extension."),
    unsupportedFormat: text("暂不支持此资源格式；未转换为截图", "This resource format is not supported yet. It was not converted to a screenshot."),
    emptyResource: text("资源内容为空", "The resource is empty."),
    resourceTooLarge: text("资源超过首版 25 MB 限制", "The resource is over the 25 MB limit."),
    importRestored: text("导入失败，原有登录数据已恢复", "Import failed. The previous sign-in data was restored."),
    importRestoreFailed: text("导入失败，部分登录数据恢复失败，请重新登录 Pinterest", "Import failed, and some sign-in data could not be restored. Sign in to Pinterest again."),
    badConnectionCode: text("连接无效或已使用，请重新生成连接码", "This connection is invalid or already used. Generate a new connection code."),
    sessionReceived: text("会话已接收。请回到 DA 刷新 Pinterest，检查是否登录成功。", `Session received. Return to ${PRODUCT_NAME}, refresh Pinterest, and check that you are signed in.`),
    sessionNotConnected: text("已取消，未接入会话", "Canceled. The session was not connected."),
    connectFailedReturn: text("接入失败，请回到 DA 查看提示并重新连接", `Could not connect. Return to ${PRODUCT_NAME}, read the message, and connect again.`),
    connectionClaimed: text("连接已被领取，请在 DA 重新发起", `This connection was already claimed. Start it again in ${PRODUCT_NAME}.`),
    defaultBrowserUnsupported(name: string): string {
      return text(
        `当前默认浏览器是 ${name}，现有实验连接器尚不支持它。`,
        `The current default browser is ${name}. The experimental connector does not support it yet.`,
      );
    },
    openPinterestIn(name: string): string {
      return text(`在 ${name} 打开 Pinterest`, `Open Pinterest in ${name}`);
    },
    browserCannotContinueSession(name: string): string {
      return text(`${name} 暂不支持会话接续；DA 登录尚未完成`, `${name} cannot continue this session yet. Sign-in to ${PRODUCT_NAME} is not finished.`);
    },
    finishSignInIn(name: string): string {
      return text(`在 ${name} 完成登录，回 DA 继续采集`, `Finish signing in with ${name}, then return to ${PRODUCT_NAME} to keep collecting.`);
    },
    continueMaySwitchAccount(detail: string): string {
      return text(
        `${detail}\n确认接续可能切换 DA 的 Pinterest 账号；平台许可与完整登录验证尚未完成。`,
        `${detail}\nContinuing may switch the Pinterest account in ${PRODUCT_NAME}. Platform permission and full sign-in checks are not finished.`,
      );
    },
    connectorConnected(name: string): string {
      return text(`${name} 连接器已连接。请在浏览器确认账号并完成登录。`, `The ${name} connector is connected. Confirm the account in the browser and finish signing in.`);
    },
    waitingForConnector(name: string): string {
      return text(
        `已请求 ${name} 打开连接器，等待连接。首次需在该浏览器安装或重新加载 DA 扩展；当前尚未完成登录。`,
        `Asked ${name} to open the connector and am waiting for it. The first time, install or reload the ${PRODUCT_NAME} extension in that browser. Sign-in is not finished yet.`,
      );
    },
    connectorNoResponse(name: string): string {
      return text(
        `未检测到 ${name} 连接器回应。请重新点击 Google 登录，选择“首次安装”，或在扩展管理页启用／重新加载连接器。`,
        `No response from the ${name} connector. Click Google sign-in again, choose “First-time install”, or enable and reload the connector on the extensions page.`,
      );
    },
    continueSignIn(name: string): string {
      return text(`继续登录 ${name}`, `Continue signing in to ${name}`);
    },
    discoverOnPort(port: number): string {
      return text(`浏览器插件可在本机 ${port} 端口自动发现`, `The browser extension can discover ${PRODUCT_NAME} on local port ${port}.`);
    },
    retrying(message: string): string {
      return text(`${message}，正在自动重试`, `${message}. Retrying automatically.`);
    },
    extensionPageOpened(name: string): string {
      return text(
        `已打开 ${name} 扩展页，并显示打包好的「${EXTENSION_PACKAGE_NAME}」。打开开发者模式，把这个文件拖进页面。`,
        `Opened the ${name} extensions page and showed the packaged “${EXTENSION_PACKAGE_NAME}”. Turn on developer mode and drag that file onto the page.`,
      );
    },
    firstConnectorInstall(name: string): string {
      return text(
        `首次使用需要在 ${name} 安装 DA 连接器，并由你确认站点权限。连接器只接续已适配网站的登录，不读取 Google 密码或 Google Cookie。当前是开发实验版，尚未上架扩展商店。`,
        `The first time, install the ${PRODUCT_NAME} connector in ${name} and confirm the site permission yourself. The connector only continues sign-in for sites that already support it. It does not read your Google password or Google cookies. This is a development experiment and is not in the extension store yet.`,
      );
    },
    loadInChromeOrEdge(name: string): string {
      return text(`当前默认浏览器是 ${name}，请用 Chrome 或 Edge 加载插件`, `The default browser is ${name}. Load the extension in Chrome or Edge.`);
    },
    downloadFailed(status: number): string {
      return text(`资源下载失败（${status}）`, `Could not download the resource (${status}).`);
    },
    file: text("文件", "File"),
    edit: text("编辑", "Edit"),
    view: text("查看", "View"),
    window: text("窗口", "Window"),
    help: text("帮助", "Help"),
    exportDiagnostics: text("导出诊断…", "Export Diagnostics…"),
    develop: text("开发", "Develop"),
    hideDevelop: text("隐藏开发菜单", "Hide Develop Menu"),
    showDevelop: text("显示开发菜单", "Show Develop Menu"),
    updateCheck: text("检查更新…", "Check for Updates…"),
    updateChecking: text("正在检查更新…", "Checking for Updates…"),
    updateDownloading: text("正在下载更新…", "Downloading Update…"),
    updateInstall: text("安装更新…", "Install Update…"),
    updateInstalling: text("正在安装更新…", "Installing Update…"),
    updateRestart: text(`重启以更新 ${PRODUCT_NAME}…`, `Restart to Update ${PRODUCT_NAME}…`),
    splashStages: {
      starting: text(`正在启动 ${PRODUCT_NAME}`, `Starting ${PRODUCT_NAME}`),
      engine: text("正在启动本地引擎", "Starting the local engine"),
      engineReady: text("本地引擎已就绪", "Local engine ready"),
      interface: text("正在准备界面", "Preparing the interface"),
      interfaceReady: text("界面已就绪", "Interface ready"),
      workspace: text("正在打开工作空间", "Opening your workspace"),
      finishing: text("即将完成", "Almost ready"),
    },
    crashTitle: text(`${PRODUCT_NAME} 在此设备上反复关闭`, `${PRODUCT_NAME} keeps closing on this device`),
    crashBody: text("应用窗口连续崩溃，已暂停自动重载，避免反复卡住。", "The app window crashed several times in a row, so it has paused to avoid getting stuck reloading."),
    crashRecovery: text("几分钟后会自动尝试恢复。", "It will try to recover on its own in a few minutes."),
    crashSaveLogs: text("保存日志…", "Save logs…"),
    crashLogsNote: text("保存的日志包含崩溃内存快照，可用于排查原因。只有你主动分享时才会发送。", "Saved logs include a crash memory snapshot so we can find the cause. Nothing is sent unless you choose to share it."),
    crashReinstall: text(`如果问题持续，退出并重新安装 ${PRODUCT_NAME} 通常可以解决。`, `If this keeps happening, quitting and reinstalling ${PRODUCT_NAME} usually resolves it.`),
    crashSavingLogs: text("正在保存日志…", "Saving logs…"),
    crashLogsSaved: text("日志已保存，请将文件附在问题报告中。", "Logs saved — please attach that file to your report."),
    crashLogsFailed: text("无法保存日志。", "Could not save logs."),
    saveAs: text("另存为", "Save As"),
    savePdf: text("保存 PDF", "Save PDF"),
    images: text("图片", "Images"),
    allFiles: text("所有文件", "All Files"),
    pdfDocument: text("PDF 文档", "PDF Document"),
    powerpointPresentation: text("PowerPoint 演示文稿", "PowerPoint Presentation"),
    zipArchive: text("ZIP 压缩包", "Zip archive"),
    exportDiagnosticsDialog: text(`导出 ${PRODUCT_NAME} 诊断文件`, `Export ${PRODUCT_NAME} diagnostics`),
    updaterUnavailable: text("桌面端更新功能不可用。", "Desktop updater is not available."),
    updateActiveTasks(count: number): string {
      return text(`${PRODUCT_NAME} 仍有 ${count} 个任务在运行。`, `${PRODUCT_NAME} is still working on ${count} active task${count === 1 ? "" : "s"}.`);
    },
    updateTaskStateUnknown: text(`${PRODUCT_NAME} 无法确认是否仍有任务在运行。`, `${PRODUCT_NAME} could not confirm whether tasks are still running.`),
    developMenuUnavailable: text("开发菜单不可用", "Develop menu unavailable"),
    amrProfile: text("AMR 环境", "AMR Profile"),
  };
}

export function desktopUpdateMenuLabels(): {
  check: string;
  checking: string;
  downloading: string;
  install: string;
  installing: string;
  restart: string;
} {
  const copy = du();
  return {
    check: copy.updateCheck,
    checking: copy.updateChecking,
    downloading: copy.updateDownloading,
    install: copy.updateInstall,
    installing: copy.updateInstalling,
    restart: copy.updateRestart,
  };
}
