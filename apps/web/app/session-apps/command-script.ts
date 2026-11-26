/** 本地指令解析脚本（用户语言输入的快速路径）：命中即本地执行，不走 Agent；
 * 未命中返回 null，由调用方转真实 Agent。意图与动作保持与 Manifest 一致。 */

export type ParsedCommand =
  | { kind: 'note.add'; text: string }
  | { kind: 'notes.read' }
  | { kind: 'projects.list' }
  | { kind: 'project.open'; target: string }
  | { kind: 'media.import' }
  | { kind: 'voice.import' }
  | { kind: 'script.import' }
  | { kind: 'help' };

const trim = (value: string) => value.trim().replace(/^[:"“”'：\s]+/u, '').replace(/[”"'。!！?？\s]+$/u, '');

export function parseCommand(input: string): ParsedCommand | null {
  const text = input.trim();
  if (!text || text.length > 500) return null;
  if (/^(帮助|help|\/help)[!！.]?$/iu.test(text)) return { kind: 'help' };
  if (/^(?:读取|刷新|查看)?便签(?:板|列表)?$/.test(text)) return { kind: 'notes.read' };
  const note = /^(?:添加|新增|记下|记录)?便签[:：，,\s]*(.{1,500})$/u.exec(text);
  if (note && trim(note[1])) return { kind: 'note.add', text: trim(note[1]) };
  if (/^(?:列出|显示|查看)?(?:全部|所有)?(?:画布)?(?:项目|看板)?(?:列表)?$|^(?:项目列表|项目|看板列表)$/u.test(text) && /列|项目|看板/u.test(text)) return { kind: 'projects.list' };
  if (/^(?:导入|上传)素材$/.test(text)) return { kind: 'media.import' };
  if (/^(?:导入|上传)配音(?:文件|音频)?$/.test(text)) return { kind: 'voice.import' };
  if (/^(?:导入|上传)(?:台词|稿件|台本)$/.test(text)) return { kind: 'script.import' };
  const open = /^(?:打开|切换到|进入)(?:画布)?(?:项目|看板)?[:：，,\s]*(.+)$/u.exec(text);
  if (open) return { kind: 'project.open', target: trim(open[1]) };
  return null;
}

export function helpText(): string {
  return '本地指令：添加便签 <文字>｜读取便签｜列出项目｜打开项目 <名称或 ID>｜导入素材｜导入配音｜导入台词｜帮助。其余输入将转发真实 Agent（需配置 MANAGED_AGENT_*）。';
}
