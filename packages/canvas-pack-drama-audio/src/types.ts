/** 短剧配音编辑卡 —— data 黑盒类型（v3，生成链路接入）。
 * 平台信封归平台，这里只定义 `node.data` 的内容形状。
 * v3 新增：dense captions（视频画面内容的分段描述 + 缩略图）、
 * 配音文档（外部模型生成）、生成来源标记（provider 显式记录，不假成功）；
 * v1/v2 旧卡缺省字段读取时兜底，原样数据不做迁移。 */

export const DRAMA_AUDIO_DATA_VERSION = 3;

/** dense caption：视频轨上一段画面的稠密描述（外部视频理解模型产出）。 */
export interface DramaAudioCaption {
  id: string;
  /** 视频时间轴区间（毫秒）。 */
  startMs: number;
  endMs: number;
  /** 画面内容描述文本。 */
  text: string;
  /** 关键帧缩略图（base64 data URL，体积受限，超限由 provider 端丢弃）。 */
  thumbnail: string | null;
}

/** 台词分段：配音源区间 + 编辑决策 + 视频对齐 + 换源（v2 形状，v3 不变）。 */
export interface DramaAudioSegment {
  id: string;
  /** 台词文本（时间轴上直接改的「文字」）。 */
  label: string;
  /** 配音源音频区间起点（毫秒）。 */
  startMs: number;
  /** 配音源音频区间终点（毫秒），必须 > startMs。 */
  endMs: number;
  /** 段后停顿（毫秒），导出时保留该间隔。 */
  gapMs: number;
  /** 段级音量 0..2，1 = 原始电平。 */
  gain: number;
  muted: boolean;
  /** 该段对应的视频画面区间（毫秒）；null = 未对齐。 */
  videoStartMs: number | null;
  videoEndMs: number | null;
  /** 段级配音源 override（工程相对路径）；null = 用主源 audioRef。 */
  audioRefOverride: string | null;
}

/** 音频卡 data 黑盒：卡内只存引用与编辑决策（EDL），媒体字节走文件口。 */
export interface DramaAudioData {
  dataVersion: 3;
  /** 配音主源（工程相对路径），未绑为 null。 */
  audioRef: string | null;
  /** 配音主源时长（毫秒）。 */
  durationMs: number;
  /** 台词分段（按 startMs 语义排列，handler 负责保持有序）。 */
  segments: DramaAudioSegment[];
  /** 全局音量 0..2。 */
  masterGain: number;
  /** 配音源裁剪窗口：null 表示该端未裁剪。 */
  trimStartMs: number | null;
  trimEndMs: number | null;
  /** 台本文本（人工或「应用配音文档」写入）。 */
  script: string | null;
  /** 最近一次导出的 EDL 清单路径与摘要。 */
  exportedPath: string | null;
  exportedDigest: string | null;
  /** 视频源引用；null = 单轨模式。 */
  videoRef: string | null;
  /** 视频源时长（毫秒）。 */
  videoDurationMs: number;
  /** v3：dense captions（按 startMs 排列）。 */
  captions: DramaAudioCaption[];
  /** v3：captions 的生成来源（provider id 或 'mock'）；null = 未生成过。 */
  captionProvider: string | null;
  /** v3：外部模型生成的配音文档（台词稿）。 */
  dubbingDoc: string | null;
  /** v3：配音文档生成来源；null = 未生成过。 */
  dubbingProvider: string | null;
  /** v3：TTS 音色/风格描述（VoxCPM control_instruction）；null = 使用默认解说风格。 */
  voiceInstruction: string | null;
}
