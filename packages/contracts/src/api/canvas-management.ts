import type { CreateProjectRequest, CreateProjectResponse, DuplicateProjectResponse, ProjectResponse } from './projects.js';

/** DA-local identity. Cloud BIZ/Session mapping is a separate host contract. */
export interface CanvasDescriptor {
  id: string;
  projectId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  ownershipModel: 'project-backed';
}
export type CreateCanvasRequest = Omit<CreateProjectRequest, 'id'> & { id?: string };
export interface CanvasResponse extends ProjectResponse { canvas: CanvasDescriptor }
export interface CreateCanvasResponse extends CreateProjectResponse { canvas: CanvasDescriptor }
export interface DuplicateCanvasResponse extends DuplicateProjectResponse { canvas: CanvasDescriptor }
export interface CanvasesResponse { canvases: CanvasDescriptor[] }
export interface RenameCanvasRequest { name: string }
