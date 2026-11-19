/** 测试数据：按句数平均切分视频区间（与按字数分配的导入规则无关，便于断言固定时间）。 */
export function evenScript(source: string, durationMs: number) {
  const texts = source.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  const rewriteLines = texts.map((text, index) => ({
    id: `line-${crypto.randomUUID()}`, text,
    videoStartMs: Math.floor(index * durationMs / texts.length),
    videoEndMs: Math.floor((index + 1) * durationMs / texts.length),
  }));
  return { script: texts.join('\n'), rewriteLines, segments: [], confirmedLineIds: [], generatedLineTexts: {}, generatedLineVoices: {} };
}
