import { describe, expect, it } from 'vitest';
import { helpText, parseCommand } from '../../apps/web/app/session-apps/command-script';

describe('session-apps 本地指令解析脚本', () => {
  it('识别添加/读取便签意图', () => {
    expect(parseCommand('添加便签 下午三点开联调会')).toEqual({ kind: 'note.add', text: '下午三点开联调会' });
    expect(parseCommand('记下便签：买菜')).toEqual({ kind: 'note.add', text: '买菜' });
    expect(parseCommand('便签 记得回消息')).toEqual({ kind: 'note.add', text: '记得回消息' });
    expect(parseCommand('读取便签')).toEqual({ kind: 'notes.read' });
    expect(parseCommand('便签板')).toEqual({ kind: 'notes.read' });
  });

  it('识别项目列表与打开意图', () => {
    expect(parseCommand('列出项目')).toEqual({ kind: 'projects.list' });
    expect(parseCommand('项目列表')).toEqual({ kind: 'projects.list' });
    expect(parseCommand('看板列表')).toEqual({ kind: 'projects.list' });
    expect(parseCommand('打开项目 drama-demo')).toEqual({ kind: 'project.open', target: 'drama-demo' });
    expect(parseCommand('切换到画布：我的项目')).toEqual({ kind: 'project.open', target: '我的项目' });
  });

  it('识别导入类与帮助意图', () => {
    expect(parseCommand('导入素材')).toEqual({ kind: 'media.import' });
    expect(parseCommand('上传素材')).toEqual({ kind: 'media.import' });
    expect(parseCommand('导入配音')).toEqual({ kind: 'voice.import' });
    expect(parseCommand('上传配音文件')).toEqual({ kind: 'voice.import' });
    expect(parseCommand('导入台词')).toEqual({ kind: 'script.import' });
    expect(parseCommand('上传台本')).toEqual({ kind: 'script.import' });
    expect(parseCommand('帮助')).toEqual({ kind: 'help' });
  });

  it('帮助与未命中返回 null 转真实 Agent', () => {
    expect(parseCommand('帮我写一段解说词')).toBeNull();
    expect(parseCommand('今天天气怎么样')).toBeNull();
    expect(parseCommand('')).toBeNull();
    expect(parseCommand('添加便签 ')).toBeNull();
    expect(helpText()).toContain('添加便签');
  });
});
