export type CapturePrefs = {
  selectionBar: boolean;
  imageHover: boolean;
};

export const DEFAULT_CAPTURE_PREFS: CapturePrefs = {
  selectionBar: true,
  imageHover: true,
};

export function parseCapturePrefs(raw: unknown): CapturePrefs {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    selectionBar: value.selectionBar !== false,
    imageHover: value.imageHover !== false,
  };
}
