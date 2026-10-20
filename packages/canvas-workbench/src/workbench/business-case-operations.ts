/** Narrow business directory binding used by optional visual generation. */
export interface CanvasBusinessCaseOperations {
  reserve(input: {
    instanceId: string;
    projectPath: string;
    text: string;
  }): Promise<{ directoryPath: string; documentId?: string }>;
}
