import React, { useState } from 'react';

/** VoxCPM control_instruction 预设：voice design 模式下靠文字描述控制音色/风格。 */
export const VOICE_PRESETS: { value: string; label: string }[] = [
  { value: '', label: '默认 · 自然清晰的普通话解说' },
  { value: '温柔亲切的女声，语速平缓', label: '温柔女声' },
  { value: '浑厚沉稳的男声，咬字清晰', label: '浑厚男声' },
  { value: '活泼明快的年轻女声，语速轻快', label: '活泼少女' },
  { value: '低沉磁性的男声旁白，节奏舒缓', label: '低沉旁白' },
  { value: '__custom__', label: '自定义…' },
];

const CUSTOM = '__custom__';
const SR_ONLY: React.CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' };
const MAX_VOICE_INSTRUCTION_LENGTH = 200;

/** 音色选择：预设下拉 + 自定义描述输入；value 为 null 表示默认音色。 */
export function VoicePicker({ value, onChange, styles, label = '音色', hideLabel = false, defaultLabel = '默认 · 自然清晰的普通话解说', defaultHint = '生成时使用默认解说风格' }: {
  value: string | null;
  label?: string;
  /** 外部已显示字段名时隐藏文字标签（仍保留给读屏），并省略默认音色提示。 */
  hideLabel?: boolean;
  defaultLabel?: string;
  defaultHint?: string;
  onChange(next: string | null): void;
  styles: Record<string, React.CSSProperties>;
}) {
  const raw = typeof value === 'string' && value.trim() ? value : null;
  const isPreset = VOICE_PRESETS.some(item => item.value === raw);
  // 选择「自定义…」后先展开输入框，等用户输入描述再提交，避免被空值重置回默认。
  const [customMode, setCustomMode] = useState(false);
  const selectValue = customMode || (raw !== null && !isPreset) ? CUSTOM : raw ?? '';
  return <label style={{ ...styles.row, ...(hideLabel ? { justifyContent: 'flex-end', flex: 1, minWidth: 0 } : {}) }}>{hideLabel ? <span style={SR_ONLY}>{label}</span> : label}
    <select style={styles.select} value={selectValue} onChange={event => {
      const next = event.target.value;
      if (next === CUSTOM) { setCustomMode(true); return; }
      setCustomMode(false);
      onChange(next === '' ? null : next);
    }}>
      {VOICE_PRESETS.map(item => <option key={item.value || 'default'} value={item.value}>{item.value === '' ? defaultLabel : item.label}</option>)}
    </select>
    {selectValue === CUSTOM && <input aria-label={`${label}描述`} style={{ flex: 1, minWidth: 140, padding: '4px 6px', border: '1px solid var(--border-default, #ddd)', borderRadius: 4, color: 'inherit', background: 'var(--bg-app, #fff)' }} placeholder="输入音色/风格描述（≤200 字符）"
      value={isPreset || raw === null ? '' : raw}
      onChange={event => onChange(event.target.value.length > MAX_VOICE_INSTRUCTION_LENGTH ? event.target.value.slice(0, MAX_VOICE_INSTRUCTION_LENGTH) : event.target.value)} />}
    {!hideLabel && raw === null && selectValue !== CUSTOM && <span style={styles.hint}>{defaultHint}</span>}
  </label>;
}
