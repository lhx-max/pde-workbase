import { describe, expect, it } from "vitest";
import { localizeDaemonMessage } from "../src/locales/daemon-messages";

describe("media and run daemon messages", () => {
  it("keeps the server sentence in Chinese and translates it in English", () => {
    const message = "提问已不可接续，未启动其他任务";
    expect(localizeDaemonMessage(message, "zh-CN")).toBe(message);
    expect(localizeDaemonMessage(message, "zh-TW")).toBe(message);
    expect(localizeDaemonMessage(message, "en")).toBe("That question can no longer be continued. No other task was started.");
    expect(localizeDaemonMessage("视频生成时长最少 4 秒，请调整镜头或生成时长", "en")).toContain("4 seconds");
    expect(localizeDaemonMessage("媒体并发上限必须为 1–32", "en")).toBe("The media concurrency limit must be from 1 to 32.");
  });

  it("leaves unknown server text unchanged", () => {
    expect(localizeDaemonMessage("当前 Agent 未登录", "en")).toBe("Sign in to the current agent and try again.");
    expect(localizeDaemonMessage("FFmpeg 启动失败：exit 1", "en")).toBe("Could not start FFmpeg. Check the media tools and try again.");
    expect(localizeDaemonMessage("等待媒体执行名额（最多 3 个并行），尚未提交供应商", "en"))
      .toBe("Waiting for a media slot (up to 3 in parallel). The provider has not received the task yet.");
    expect(localizeDaemonMessage("未收录的服务端错误", "en")).toBe("The operation could not be completed. Try again.");
    expect(localizeDaemonMessage("未收录的服务端错误", "zh-CN")).toBe("未收录的服务端错误");
    expect(localizeDaemonMessage("", "en")).toBe("");
  });
});
