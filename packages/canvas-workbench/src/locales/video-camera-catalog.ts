import type { IconName } from '../ui/Icon';
import { getCanvasActiveLocale } from '../platform/canvas-locale';
import { resolveCanvasLocale } from './node-catalog';

export type VideoCameraMoveId = 'orbit_left' | 'orbit_right' | 'push_in' | 'pull_out' | 'crane_up' | 'crane_down' | 'track_left' | 'track_right' | 'arc_left' | 'arc_right' | 'zoom_in' | 'zoom_out' | 'dolly_zoom';
export type VideoCameraSpeed = 'slow' | 'medium' | 'fast';
export type VideoCameraShot = 'wide' | 'medium' | 'close';
export type VideoCameraMove = { move: VideoCameraMoveId; speed: VideoCameraSpeed; shot: VideoCameraShot };

type MoveRow = { id: VideoCameraMoveId; label: string; description: string; icon: IconName };
type SpeedRow = { id: VideoCameraSpeed; label: string; prompt: string };
type ShotRow = { id: VideoCameraShot; label: string; prompt: string };

const MOVES_EN: MoveRow[] = [
  { id: 'orbit_left', label: 'Orbit left', description: 'Camera orbits the subject counterclockwise to reveal surrounding space.', icon: 'refresh' },
  { id: 'orbit_right', label: 'Orbit right', description: 'Camera orbits the subject clockwise to reveal surrounding space.', icon: 'refresh' },
  { id: 'push_in', label: 'Push in', description: 'Camera pushes toward the subject, intensifying focus and emotion.', icon: 'search' },
  { id: 'pull_out', label: 'Pull out', description: 'Camera pulls away from the subject to reveal more environment.', icon: 'search' },
  { id: 'crane_up', label: 'Crane up', description: 'Camera rises from eye level into a higher, more overhead view.', icon: 'arrow-up' },
  { id: 'crane_down', label: 'Crane down', description: 'Camera descends from a high position back to eye level or a low angle.', icon: 'arrow-down' },
  { id: 'track_left', label: 'Track left', description: 'Camera trucks left while holding distance to the subject.', icon: 'arrow-right' },
  { id: 'track_right', label: 'Track right', description: 'Camera trucks right while holding distance to the subject.', icon: 'arrow-right' },
  { id: 'arc_left', label: 'Arc left', description: 'Camera follows a shallow left arc for a slight angle change.', icon: 'refresh' },
  { id: 'arc_right', label: 'Arc right', description: 'Camera follows a shallow right arc for a slight angle change.', icon: 'refresh' },
  { id: 'zoom_in', label: 'Zoom in', description: 'Camera stays put; lens tightens, magnifying the frame and compressing space.', icon: 'search' },
  { id: 'zoom_out', label: 'Zoom out', description: 'Camera stays put; lens widens to show more environment.', icon: 'search' },
  { id: 'dolly_zoom', label: 'Dolly zoom', description: 'Camera dollies out while zooming in, holding subject size and stretching the background.', icon: 'eye' },
];
const MOVES_ZH: MoveRow[] = [
  { id: 'orbit_left', label: '左环绕', description: '相机逆时针绕主体运动，展示主体周围空间。', icon: 'refresh' },
  { id: 'orbit_right', label: '右环绕', description: '相机顺时针绕主体运动，展示主体周围空间。', icon: 'refresh' },
  { id: 'push_in', label: '推近', description: '相机向主体推进，逐渐强化主体和情绪。', icon: 'search' },
  { id: 'pull_out', label: '拉远', description: '相机从主体拉远，逐渐揭示环境。', icon: 'search' },
  { id: 'crane_up', label: '升镜', description: '相机从平视向上升高，逐渐形成俯视。', icon: 'arrow-up' },
  { id: 'crane_down', label: '降镜', description: '相机从高位下降，回到平视或仰视。', icon: 'arrow-down' },
  { id: 'track_left', label: '左横移跟拍', description: '相机向左横移并保持与主体的距离。', icon: 'arrow-right' },
  { id: 'track_right', label: '右横移跟拍', description: '相机向右横移并保持与主体的距离。', icon: 'arrow-right' },
  { id: 'arc_left', label: '左弧线', description: '相机沿小角度左弧线轻微改变视角。', icon: 'refresh' },
  { id: 'arc_right', label: '右弧线', description: '相机沿小角度右弧线轻微改变视角。', icon: 'refresh' },
  { id: 'zoom_in', label: '变焦推', description: '机位不动，收窄视角放大画面并压缩空间。', icon: 'search' },
  { id: 'zoom_out', label: '变焦拉', description: '机位不动，放宽视角以展示更多环境。', icon: 'search' },
  { id: 'dolly_zoom', label: '希区柯克', description: '机位后拉同时推焦，保持主体大小并拉伸背景。', icon: 'eye' },
];
const SPEEDS_EN: SpeedRow[] = [
  { id: 'slow', label: 'Slow', prompt: 'slow and steady' },
  { id: 'medium', label: 'Medium', prompt: 'medium, natural pace' },
  { id: 'fast', label: 'Fast', prompt: 'fast, energetic' },
];
const SPEEDS_ZH: SpeedRow[] = [
  { id: 'slow', label: '慢', prompt: '缓慢、平稳' },
  { id: 'medium', label: '中', prompt: '中速、自然' },
  { id: 'fast', label: '快', prompt: '快速、有动势' },
];
const SHOTS_EN: ShotRow[] = [
  { id: 'wide', label: 'Wide', prompt: 'wide shot' },
  { id: 'medium', label: 'Medium', prompt: 'medium shot' },
  { id: 'close', label: 'Close', prompt: 'close-up' },
];
const SHOTS_ZH: ShotRow[] = [
  { id: 'wide', label: '远', prompt: '远景' },
  { id: 'medium', label: '中', prompt: '中景' },
  { id: 'close', label: '近', prompt: '近景' },
];

export function videoCameraMoves(locale?: string | null): MoveRow[] {
  return resolveCanvasLocale(locale) === 'zh-CN' ? MOVES_ZH : MOVES_EN;
}
export function videoCameraSpeeds(locale?: string | null): SpeedRow[] {
  return resolveCanvasLocale(locale) === 'zh-CN' ? SPEEDS_ZH : SPEEDS_EN;
}
export function videoCameraShots(locale?: string | null): ShotRow[] {
  return resolveCanvasLocale(locale) === 'zh-CN' ? SHOTS_ZH : SHOTS_EN;
}

/** Backward-compatible default arrays (zh) for existing imports of constants. */
export const VIDEO_CAMERA_MOVES = MOVES_ZH;
export const VIDEO_CAMERA_SPEEDS = SPEEDS_ZH;
export const VIDEO_CAMERA_SHOTS = SHOTS_ZH;

export const DEFAULT_VIDEO_CAMERA_MOVE: VideoCameraMove = { move: 'push_in', speed: 'medium', shot: 'medium' };

export function videoCameraMoveInstruction(value: VideoCameraMove | undefined, locale?: string | null): string {
  if (!value) return '';
  const loc = locale ?? getCanvasActiveLocale();
  const move = videoCameraMoves(loc).find(option => option.id === value.move);
  const speed = videoCameraSpeeds(loc).find(option => option.id === value.speed);
  const shot = videoCameraShots(loc).find(option => option.id === value.shot);
  if (!move || !speed || !shot) return '';
  if (resolveCanvasLocale(loc) === 'zh-CN') {
    return `镜头运动：${move.label}（${move.description}）\n运镜速度：${speed.prompt}\n景别：${shot.prompt}`;
  }
  return `Camera move: ${move.label} (${move.description})\nSpeed: ${speed.prompt}\nShot size: ${shot.prompt}`;
}

export function videoCameraMoveSummary(value: VideoCameraMove | undefined, locale?: string | null): string {
  const loc = locale ?? getCanvasActiveLocale();
  const unset = resolveCanvasLocale(loc) === 'zh-CN' ? '未设置' : 'Not set';
  if (!value) return unset;
  const move = videoCameraMoves(loc).find(option => option.id === value.move)?.label;
  const speed = videoCameraSpeeds(loc).find(option => option.id === value.speed)?.label;
  const shot = videoCameraShots(loc).find(option => option.id === value.shot)?.label;
  if (!(move && speed && shot)) return unset;
  return resolveCanvasLocale(loc) === 'zh-CN'
    ? `${move} · ${speed}速 · ${shot}景`
    : `${move} · ${speed} · ${shot}`;
}
