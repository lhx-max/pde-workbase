/**
 * 保持音调的时间伸缩（WSOLA）：按 rate 改变时长，rate > 1 变快变短，rate < 1 变慢变长。
 * 每帧在理想位置附近寻找与上一帧延续最相似的片段再叠加，避免变速带来的音调变化与相位噪声。
 * 所有声道共用同一组偏移，保证立体声同步。
 */
const FRAME_SECONDS = 0.04;
const SEARCH_SECONDS = 0.012;
const CORRELATION_STRIDE = 8;

export function stretchChannels(channels: Float32Array[], sampleRate: number, rate: number): Float32Array[] {
  if (!channels.length) return [];
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('变速倍率无效。');
  const input = channels[0]!;
  const outLength = Math.max(1, Math.round(input.length / rate));
  if (Math.abs(rate - 1) < 1e-3) return channels.map(channel => channel.slice());
  const frame = Math.max(16, Math.round(sampleRate * FRAME_SECONDS));
  if (input.length <= frame) return channels.map(channel => resample(channel, outLength));
  const hopOut = Math.floor(frame / 2);
  const hopIn = hopOut * rate;
  const tolerance = Math.round(sampleRate * SEARCH_SECONDS);
  const window = new Float32Array(frame);
  for (let i = 0; i < frame; i++) window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (frame - 1));
  const outputs = channels.map(() => new Float32Array(outLength + frame));
  const weight = new Float32Array(outLength + frame);
  const lastStart = input.length - frame;
  let previous = 0;
  for (let k = 0, outPos = 0; outPos < outLength; k++, outPos += hopOut) {
    const ideal = Math.min(lastStart, Math.round(k * hopIn));
    let best = ideal;
    if (k > 0) {
      // 上一帧自然延续的位置，和候选位置做互相关，取最相似的。
      const target = Math.min(lastStart, previous + hopOut);
      let bestScore = -Infinity;
      for (let candidate = Math.max(0, ideal - tolerance); candidate <= Math.min(lastStart, ideal + tolerance); candidate += 2) {
        let score = 0;
        for (let i = 0; i < hopOut; i += CORRELATION_STRIDE) score += input[candidate + i]! * input[target + i]!;
        if (score > bestScore) { bestScore = score; best = candidate; }
      }
    }
    for (let c = 0; c < channels.length; c++) {
      const source = channels[c]!;
      const output = outputs[c]!;
      for (let i = 0; i < frame; i++) output[outPos + i] = output[outPos + i]! + source[best + i]! * window[i]!;
    }
    for (let i = 0; i < frame; i++) weight[outPos + i] = weight[outPos + i]! + window[i]!;
    previous = best;
  }
  return outputs.map(output => {
    const result = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) result[i] = weight[i]! > 1e-3 ? output[i]! / weight[i]! : 0;
    return result;
  });
}

/** 极短的片段直接线性重采样。 */
function resample(channel: Float32Array, length: number): Float32Array {
  const result = new Float32Array(length);
  const scale = channel.length > 1 ? (channel.length - 1) / Math.max(1, length - 1) : 0;
  for (let i = 0; i < length; i++) {
    const position = i * scale;
    const left = Math.floor(position);
    const right = Math.min(channel.length - 1, left + 1);
    result[i] = (channel[left] ?? 0) + ((channel[right] ?? 0) - (channel[left] ?? 0)) * (position - left);
  }
  return result;
}

/** 伸缩一个 AudioBuffer，返回在同一上下文创建的新 buffer。 */
export function stretchBuffer(context: BaseAudioContext, buffer: AudioBuffer, rate: number): AudioBuffer {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const stretched = stretchChannels(channels, buffer.sampleRate, rate);
  const result = context.createBuffer(buffer.numberOfChannels, stretched[0]!.length, buffer.sampleRate);
  stretched.forEach((channel, index) => result.copyToChannel(channel as Float32Array<ArrayBuffer>, index));
  return result;
}
