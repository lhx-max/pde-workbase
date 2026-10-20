import { readFileSync } from "node:fs";
import { join } from "node:path";

// Chrome starts these hosts as their own CommonJS processes. They cannot import
// the ESM desktop locale module. A missing file follows LANG; an empty file stays Chinese.
// DEFAULT_PRODUCT_NAME matches the default manifest display name. A locale file's
// second line overrides it for OEM builds.

const DEFAULT_PRODUCT_NAME = "Loom";
let localeDir: string | null = null;

export function bindNativeHostLocaleDir(directory: string | null | undefined): void {
  const value = (directory ?? "").trim();
  localeDir = value || null;
}

function localeFromTag(raw: string | undefined): "zh-CN" | "en" | null {
  const value = (raw ?? "").trim().toLowerCase().split(".")[0]?.replace(/_/g, "-") ?? "";
  if (!value || value === "c" || value === "posix") return null;
  if (value === "zh" || value.startsWith("zh-")) return "zh-CN";
  return "en";
}

function readLocaleFile(): { locale: string; productName: string } | null {
  if (!localeDir) return null;
  try {
    const raw = readFileSync(join(localeDir, "ui-locale"), "utf8");
    const [localeLine, nameLine] = raw.split(/\r?\n/);
    return { locale: localeLine ?? "", productName: (nameLine ?? "").trim() };
  } catch {
    return null;
  }
}

function active(): { locale: "zh-CN" | "en"; productName: string } {
  const file = readLocaleFile();
  if (file) {
    return {
      locale: localeFromTag(file.locale) ?? "zh-CN",
      productName: file.productName || DEFAULT_PRODUCT_NAME,
    };
  }
  const fromEnv = localeFromTag(process.env.LC_ALL) ?? localeFromTag(process.env.LANG);
  return { locale: fromEnv ?? "zh-CN", productName: DEFAULT_PRODUCT_NAME };
}

export function nhu() {
  const { locale, productName } = active();
  const text = (zh: string, en: string) => (locale === "zh-CN" ? zh : en);
  return {
    responseTooLarge: text("连接响应过大", "The connection response is too large."),
    responseInvalid: text("连接响应无效", "The connection response is invalid."),
    disconnectedRecovering: text(
      `${productName} 连接已断开，正在自动恢复`,
      `The ${productName} connection dropped and is reconnecting.`,
    ),
    appNotRunning: text(`${productName} 未启动，正在自动检测`, `${productName} is not running. Looking for it.`),
    appNotResponding: text(
      `${productName} 暂未响应，正在自动重连`,
      `${productName} has not responded yet. Reconnecting.`,
    ),
    invalidRequest: text("请求无效", "The request is invalid."),
    connectionUnavailable: text("连接不可用", "The connection is unavailable."),
    startSignInFirst: text(
      `请先在 ${productName} 中发起登录连接`,
      `Start the sign-in connection in ${productName} first.`,
    ),
  };
}
