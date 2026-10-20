// Storyboard persisted enum values stay Chinese for backward compatibility.
// This file lives under locales/ so the hardcoded-CJK scanner skips it.

export const STORYBOARD_SHOT_SIZES = ['远景', '全景', '中景', '近景', '特写'] as const;
export type StoryboardShotSize = (typeof STORYBOARD_SHOT_SIZES)[number];

export const STORYBOARD_CAMERA_MOVE_LABELS = ['推进', '拉远', '环绕', '跟拍', '横移', '固定'] as const;

export const CAMERA_MOVE_TO_VIDEO: Record<string, string> = {
  推进: 'push_in',
  拉远: 'pull_out',
  环绕: 'orbit',
  跟拍: 'follow',
  横移: 'truck',
  固定: 'static',
};

export const STORYBOARD_CAMERA_MOVEMENTS = ['固定', '推进', '拉远', '横移', '跟拍', '环绕'] as const;
export type StoryboardCameraMovement = (typeof STORYBOARD_CAMERA_MOVEMENTS)[number];

export const SHOT_SIZE_EXTREME_WIDE = STORYBOARD_SHOT_SIZES[0];
export const SHOT_SIZE_WIDE = STORYBOARD_SHOT_SIZES[1];
export const SHOT_SIZE_MEDIUM = STORYBOARD_SHOT_SIZES[2];
export const SHOT_SIZE_CLOSE = STORYBOARD_SHOT_SIZES[3];
export const SHOT_SIZE_EXTREME_CLOSE = STORYBOARD_SHOT_SIZES[4];

export const CAMERA_MOVEMENT_STATIC = STORYBOARD_CAMERA_MOVEMENTS[0];
export const CAMERA_MOVEMENT_PUSH = STORYBOARD_CAMERA_MOVEMENTS[1];
