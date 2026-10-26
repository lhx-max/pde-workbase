/** Read-only handoff from a canvas image card to its independently owned App.
 * No image-App storage identity is invented here. The App resolves this source.
 */
export interface CanvasImageEditorTarget {
  appId: 'image';
  kind: 'image';
  canvasInstanceId: string;
  nodeId: string;
  endpoint: string;
  filePath: string;
  revision: number;
  name: string;
  naturalWidth?: number;
  naturalHeight?: number;
}
