import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';

const origin = 'http://127.0.0.1:8808';
let child: ChildProcess | null = null;
let starting: Promise<void> | null = null;

async function ready(): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/gradio_api/info`, { signal: AbortSignal.timeout(1500), redirect: 'error' });
    if (!response.ok) return false;
    const info = await response.json() as { named_endpoints?: Record<string, unknown> };
    return !!info.named_endpoints?.['/generate'];
  } catch { return false; }
}

function configuredPath(name: string, directory = false): string {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value) || !existsSync(value)) throw new Error(`本地 TTS 未配置有效的 ${name}`);
  if (!directory && name === 'DRAMA_TTS_APP' && path.basename(value) !== 'app.py') throw new Error('本地 TTS 启动入口必须为 app.py');
  return value;
}

export async function ensureLocalTts(): Promise<void> {
  if (process.env.CANVAS_STORAGE_MODE !== 'local-test' || process.env.DRAMA_TTS_ENABLED !== '1') {
    throw new Error('本地 TTS 启动仅允许显式启用的 local-test demo');
  }
  if (starting) return starting;
  starting = (async () => {
    if (await ready()) return;
    const python = configuredPath('DRAMA_TTS_PYTHON');
    const app = configuredPath('DRAMA_TTS_APP');
    const model = configuredPath('DRAMA_TTS_MODEL', true);
    const root = configuredPath('CANVAS_DATA_DIR', true);
    const logDir = path.join(root, 'tts-runtime');
    mkdirSync(logDir, { recursive: true, mode: 0o700 });
    const log = openSync(path.join(logDir, 'voxcpm.log'), 'a', 0o600);
    let failure = '';
    try {
      if (!child || child.exitCode !== null || child.signalCode !== null) {
        child = spawn(python, [app, '--host', '127.0.0.1', '--port', '8808', '--model-id', model, '--device', 'auto'], {
          cwd: path.dirname(app),
          env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG, PYTHONUNBUFFERED: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' },
          stdio: ['ignore', log, log],
        });
        child.once('error', error => { failure = error.message; });
        child.unref();
      }
    } finally { closeSync(log); }
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (failure || child?.exitCode !== null || child?.signalCode !== null) {
        throw new Error('本地 TTS 启动失败，请检查数据目录 tts-runtime/voxcpm.log');
      }
      if (await ready()) return;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('本地 TTS 尚未就绪，请检查 tts-runtime/voxcpm.log 后再次检查；未提交配音任务');
  })();
  try { await starting; }
  finally { starting = null; }
}
