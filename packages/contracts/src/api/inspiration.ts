/** Experimental, anonymous read-only inspiration source. No reuse license is implied. */
export interface InspirationImage {
  url: string;
  width: number | null;
  height: number | null;
  expiresAt: string | null;
}

export interface InspirationItem {
  source: 'jimeng';
  id: string;
  itemType: 9 | 109;
  sourceUrl: string;
  title: string;
  author: { id: string | null; name: string };
  thumbnailUrl: string | null;
  images: InspirationImage[];
  /** Publicly exposed prompt only; null means unavailable, never AI-inferred. */
  prompt: string | null;
  model: string | null;
  publishedAt: string | null;
}

export interface InspirationCategories {
  source: 'jimeng';
  categories: Array<{ id: string; name: string; scenes: Array<{ id: string; name: string }> }>;
  fetchedAt: string;
}

export interface InspirationFeedQuery {
  /** Scene ID from categories, e.g. the poster scene inside graphic design. */
  categoryId: string;
  cursor?: string;
  limit?: number;
}

export interface InspirationFeed {
  source: 'jimeng';
  categoryId: string;
  items: InspirationItem[];
  nextCursor: string | null;
  hasMore: boolean;
  /** Non-image or malformed entries omitted from this upstream page. */
  skippedCount: number;
  fetchedAt: string;
}

export interface InspirationDetail {
  item: InspirationItem;
  fetchedAt: string;
}

export type InspirationErrorCode = 'INVALID_INPUT' | 'UPSTREAM_REJECTED' | 'UPSTREAM_UNAVAILABLE' | 'UPSTREAM_CHANGED' | 'BUSY' | 'NOT_FOUND';
export interface InspirationErrorResponse {
  error: { code: InspirationErrorCode; message: string };
}
