/** Immutable Image-owned resource identity. Canvas owns placement and preview,
 * while configuration, tasks, editable content and bytes remain in Image. */
export interface CanvasImageReference {
  applicationId:string;
  applicationInstanceId:string;
  providerInstanceId:string;
  teamId:string;
  bizId:string;
  workspaceId:string;
  assetId:string;
  mime:string;
  sha256:string;
  width:number;
  height:number;
}
