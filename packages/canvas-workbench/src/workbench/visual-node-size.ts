export const VISUAL_NODE_SIZE = {
  '1:1': { width: 350, height: 350 },
  '3:4': { width: 300, height: 400 },
  '4:3': { width: 400, height: 300 },
  '9:16': { width: 236, height: 420 },
  '16:9': { width: 420, height: 236 },
};

/** Widescreen HTML/PPT cards so dropped pages keep a desktop layout. */
export const HTML_PAGE_CARD_SIZE = { width: 640, height: 360 } as const;
