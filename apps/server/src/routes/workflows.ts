import path from 'node:path';
import type { Express } from 'express';
import type { Database } from '../storage/database.js';
import type { ProjectRegistry } from '../storage/project-registry.js';
import type { CanvasStateService } from '../canvas/state.js';
import type { AgentAdapter } from '../services-tasks.js';
import { migrateWorkflows, reconcileWorkflowRuns } from '../workflows/persistence.js';
import { GenericWorkflowGraphService } from '../workflows/generic-graph.js';
import { WorkflowResultService } from '../workflows/results.js';
import { WorkflowExecutionService, type WorkflowExecutionPorts } from '../workflows/execution.js';
import { createTaskWorkflowPorts, type WorkflowTaskPort, type WorkflowExecutionAuthority } from '../workflows/task-ports.js';
import { registerWorkflowGraphRoutes, type WorkflowGraphRouteDeps } from './workflow-graphs.js';
import { registerWorkflowResultRoutes } from './workflow-results.js';
import type { AuthorizeProjectRequest } from '../workflows/ports.js';

export interface RegisterWorkflowRoutesDeps extends WorkflowExecutionAuthority {
  db: Database;
  registry: ProjectRegistry;
  canvas: Pick<CanvasStateService, 'workflowFileVersions' | 'materializeWorkflowArtifact'>;
  /** Supply the same task service used by ordinary canvas generation. */
  tasks?: WorkflowTaskPort;
  agent?: AgentAdapter;
  executionPorts?: WorkflowExecutionPorts;
  authorize?: AuthorizeProjectRequest;
  workflowsDir?: string;
  builtInSkillsDir?: string;
  assistant?: WorkflowGraphRouteDeps['assistant'];
  skillCatalog?: WorkflowGraphRouteDeps['skillCatalog'];
  media?: WorkflowGraphRouteDeps['media'];
}
/** Independent composition of the original graph compiler, durable executor,
 * result adapter, schema migrations and unchanged canvas delivery ownership. */
export function registerWorkflowRoutes(app: Express, deps: RegisterWorkflowRoutesDeps) {
  const { db, registry, canvas } = deps;
  db.exec('CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY)');
  for (const project of registry.list()) db.prepare('INSERT OR IGNORE INTO projects(id) VALUES (?)').run(project.id);
  migrateWorkflows(db);
  reconcileWorkflowRuns(db);
  const results = new WorkflowResultService(db);
  const graphs = new GenericWorkflowGraphService(db, results, {
    fileVersions: (projectId, value, verifyOnly) => canvas.workflowFileVersions(projectId, value, verifyOnly),
    materialize: ({ projectId, image, ...input }) => canvas.materializeWorkflowArtifact(projectId, { ...input, ...(image ? { image } : {}) }),
  });
  graphs.register();
  const ports = deps.executionPorts ?? (deps.agent && deps.tasks ? createTaskWorkflowPorts(deps.tasks, registry, deps) : undefined);
  const execution = ports ? new WorkflowExecutionService(db, graphs, ports) : undefined;
  const authorize: AuthorizeProjectRequest = async (req, res, projectId, options) => {
    if (!registry.get(projectId)) { res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project does not exist' } }); return false; }
    if (deps.authorize && !await deps.authorize(req, res, projectId, options)) return false;
    db.prepare('INSERT OR IGNORE INTO projects(id) VALUES (?)').run(projectId);
    return true;
  };
  registerWorkflowGraphRoutes(app, { service: graphs, ...(execution ? { execution } : {}), authorizeProjectRequest: authorize,
    dataDir: registry.dataRoot, workflowsDir: deps.workflowsDir ?? path.join(registry.dataRoot, 'workflows'),
    ...(deps.builtInSkillsDir ? { builtInSkillsDir: deps.builtInSkillsDir } : {}),
    ...(deps.assistant ? { assistant: deps.assistant } : {}), ...(deps.skillCatalog ? { skillCatalog: deps.skillCatalog } : {}), ...(deps.media ? { media: deps.media } : {}),
  });
  registerWorkflowResultRoutes(app, { service: results, authorizeProjectRequest: authorize, ...(execution ? { execution } : {}) });
  execution?.start();
  return { graphs, results, execution, stop: () => execution?.stop() };
}
