import React from 'react';

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
const MAX_VOICE_INSTRUCTION_LENGTH = 200;

/** 音色选择：预设下拉 + 自定义描述输入；value 为 null 表示默认音色。 */
export function VoicePicker({ value, onChange, styles, label = '音色', defaultLabel = '默认 · 自然清晰的普通话解说', defaultHint = '生成时使用默认解说风格' }: {
  value: string | null;
  label?: string;
  defaultLabel?: string;
  defaultHint?: string;
  onChange(next: string | null): void;
  styles: Record<string, React.CSSProperties>;
}) {
  const raw = typeof value === 'string' && value.trim() ? value : null;
  const isPreset = VOICE_PRESETS.some(item => item.value === raw);
  const selectValue = raw !== null && !isPreset ? CUSTOM : raw ?? '';
  return <label style={styles.row}>{label}
    <select style={styles.select} value={selectValue} onChange={event => {
      const next = event.target.value;
      if (next === CUSTOM) { onChange(raw !== null && !isPreset ? raw : ''); return; }
      onChange(next === '' ? null : next);
    }}>
      {VOICE_PRESETS.map(item => <option key={item.value || 'default'} value={item.value}>{item.value === '' ? defaultLabel : item.label}</option>)}
    </select>
    {selectValue === CUSTOM && <input style={{ flex: 1, minWidth: 140, padding: '4px 6px', border: '1px solid var(--border-default, #ddd)', borderRadius: 4, color: 'inherit', background: 'var(--bg-app, #fff)' }} placeholder="输入音色/风格描述（≤200 字符）"
      value={isPreset || raw === null ? '' : raw}
      onChange={event => onChange(event.target.value.length > MAX_VOICE_INSTRUCTION_LENGTH ? event.target.value.slice(0, MAX_VOICE_INSTRUCTION_LENGTH) : event.target.value)} />}
    {raw === null && <span style={styles.hint}>{defaultHint}</span>}
  </label>;
}
