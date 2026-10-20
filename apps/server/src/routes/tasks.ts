import type { Express, RequestHandler } from 'express';
import type { AgentTasks, TaskDelivery, TaskRequest } from '../services-tasks.js';
import type { ProjectRegistry } from '../storage/project-registry.js';
import type { ProjectLedger } from '../project-ledger/service.js';
import type { CanvasStateService } from '../canvas/state.js';
import { listFiles } from '../projects.js';
export function registerTaskRoutes(app: Express, deps: {tasks:AgentTasks;registry:ProjectRegistry;ledger:ProjectLedger;canvas:CanvasStateService;authorize:RequestHandler}):void {
 const fail=(res:Parameters<RequestHandler>[1],error:unknown)=>{const e=error as {status?:number;code?:string;message?:string};res.status(e.status??400).json({error:{code:e.code??'TASK_REQUEST_FAILED',message:e.message??String(error)}});};
 app.post('/api/projects/:id/agent/tasks',deps.authorize,async(req,res)=>{try {res.status(202).json({ok:true,task:await deps.tasks.submit(String(req.params.id),req.body as TaskRequest)});}catch(e){fail(res,e);}});
 app.get('/api/projects/:id/agent/tasks',deps.authorize,(req,res)=>{try{res.json({ok:true,tasks:deps.tasks.list(String(req.params.id))});}catch(e){fail(res,e);}});
 app.post('/api/projects/:id/agent/tasks/:taskId/adopt',deps.authorize,async(req,res)=>{try{res.json({ok:true,task:await deps.tasks.adoptText(String(req.params.id),String(req.params.taskId))});}catch(e){fail(res,e);}});
 app.get('/api/projects/:id/agent/tasks/:taskId',deps.authorize,(req,res)=>{try{const task=deps.tasks.get(String(req.params.id),String(req.params.taskId));if(!task){res.status(404).json({error:{code:'TASK_NOT_FOUND',message:'Task not found'}});return;}res.json({ok:true,task});}catch(e){fail(res,e);}});
 app.delete('/api/projects/:id/agent/tasks/:taskId',deps.authorize,async(req,res)=>{try{const task=await deps.tasks.cancel(String(req.params.id),String(req.params.taskId));if(!task){res.sendStatus(404);return;}res.json({ok:true,task});}catch(e){fail(res,e);}});
 app.post('/api/projects/:id/agent/tasks/:taskId/delivery',deps.authorize,async(req,res)=>{try{res.json({ok:true,task:await deps.tasks.deliver(String(req.params.id),String(req.params.taskId),req.body as TaskDelivery)});}catch(e){fail(res,e);}});
 app.post('/api/projects/:id/canvas/artifacts',deps.authorize,async(req,res)=>{try{
  const projectId=String(req.params.id),project=deps.registry.get(projectId);if(!project){res.sendStatus(404);return;}
  const {taskId,path:filePath}=req.body??{};if(typeof taskId!=='string'||!taskId||typeof filePath!=='string')throw new Error('taskId and path required');
  const files=await listFiles(deps.registry.projectsRoot,projectId,{metadata:project.metadata,scope:'all'});
  const file=files.find((file:{name:string})=>file.name===filePath);if(!file)throw new Error('artifact file not found');
  res.json({ok:true,...await deps.canvas.materializeTaskArtifact(projectId,{taskId,file})});
 }catch(e){fail(res,e);}});
 app.get('/api/projects/:id/ledger',deps.authorize,(req,res)=>{try{res.json(deps.ledger.list(String(req.params.id),{limit:Number(req.query.limit)||50,...(typeof req.query.cursor==='string'?{cursor:req.query.cursor}:{})}));}catch(e){fail(res,e);}});
}
