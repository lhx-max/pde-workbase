import type {Express,Request,Response} from 'express';
import type {MediaAdapterService} from '../media/adapter-service.js';
import type {ProjectRegistry} from '../storage/project-registry.js';
export interface CapabilityAdapter {
 agents?():Promise<unknown>;
 models?(agentId?:string):Promise<unknown>;
 knowledge?(query:Record<string,unknown>):Promise<unknown>;
 resources?(kind:string,id?:string):Promise<unknown>;
}
const emptyCatalog={providers:[],image:[],video:[],audio:{speech:[],sfx:[],music:[]},aspects:['1:1','16:9','9:16','4:3','3:4'],videoLengthsSec:[],audioDurationsSec:[]};
export function registerMediaRoutes(app:Express,deps:{media:MediaAdapterService;registry:ProjectRegistry;capabilities?:CapabilityAdapter;authorizeGeneration?:(projectId:string,input:Record<string,unknown>)=>Promise<void>}):void{
 const {media,registry}=deps;
 const fail=(res:Response,error:unknown)=>{const value=error as {status?:number;code?:string;message?:string};res.status(value.status??400).json({error:{code:value.code??'MEDIA_REQUEST_FAILED',message:value.message??String(error)}});};
 app.get('/api/media/models',async(_req,res)=>{try{res.json(media.adapter?await media.adapter.catalog():emptyCatalog);}catch(e){fail(res,e);}});
 app.get('/api/media/config',async(_req,res)=>{try{res.json(media.adapter?await media.adapter.config():{providers:{}});}catch(e){fail(res,e);}});
 app.put('/api/media/config',async(req,res)=>{try{if(!media.adapter?.configure){res.status(503).json({error:{code:'MEDIA_CONFIGURATION_UNAVAILABLE',message:'Media configuration is owned by the configured adapter'}});return;}res.json(await media.adapter.configure(req.body));}catch(e){fail(res,e);}});
 app.get('/api/agents',async(_req,res)=>{try{res.json(await deps.capabilities?.agents?.()??[]);}catch(e){fail(res,e);}});
 app.get(['/api/models','/api/agents/:agentId/models'],async(req,res)=>{try{res.json(await deps.capabilities?.models?.(typeof req.params.agentId==='string'?req.params.agentId:undefined)??{models:[]});}catch(e){fail(res,e);}});
 app.get(['/api/knowledge','/api/knowledge/resources'],async(req,res)=>{try{res.json(await deps.capabilities?.knowledge?.(req.query)??{resources:[]});}catch(e){fail(res,e);}});
 for(const kind of ['image-library-templates','design-templates','design-systems','skills']){
  app.get(`/api/${kind}`,async(_req,res)=>{try{if(!deps.capabilities?.resources){res.status(503).json({error:{code:'RESOURCE_ADAPTER_UNAVAILABLE',message:'No resource adapter configured'}});return;}res.json(await deps.capabilities.resources(kind));}catch(e){fail(res,e);}});
  app.get(`/api/${kind}/:id`,async(req,res)=>{try{if(!deps.capabilities?.resources){res.status(503).json({error:{code:'RESOURCE_ADAPTER_UNAVAILABLE',message:'No resource adapter configured'}});return;}res.json(await deps.capabilities.resources(kind,String(req.params.id)));}catch(e){fail(res,e);}});
 }
 app.get('/api/design-systems/:id/showcase',async(req,res)=>{try{if(!deps.capabilities?.resources){res.status(503).json({error:{code:'RESOURCE_ADAPTER_UNAVAILABLE',message:'No resource adapter configured'}});return;}res.json(await deps.capabilities.resources('design-system-showcase',String(req.params.id)));}catch(e){fail(res,e);}});
 app.post('/api/projects/:id/media/generate',async(req,res)=>{try{await deps.authorizeGeneration?.(String(req.params.id),req.body);res.status(202).json(await media.submit(String(req.params.id),req.body));}catch(e){fail(res,e);}});
 app.get('/api/projects/:id/media/tasks',(req,res)=>{try{const id=String(req.params.id);if(!registry.get(id)){res.sendStatus(404);return;}const ids=typeof req.query.taskIds==='string'?[...new Set(req.query.taskIds.split(',').filter(Boolean))]:undefined;if(ids&&ids.length>200)throw new Error('taskIds accepts at most 200 task IDs');res.json({tasks:media.list(id,req.query.includeDone==='1'||req.query.includeDone==='true',ids)});}catch(e){fail(res,e);}});
 const own=(req:Request,res:Response)=>{const task=media.get(String(req.params.taskId??req.params.id));if(!task||!registry.get(task.projectId)||(req.params.projectId&&req.params.projectId!==task.projectId)){res.status(404).json({error:{code:'MEDIA_TASK_NOT_FOUND',message:'Media task not found'}});return null;}return task;};
 app.get(['/api/media/tasks/:taskId','/api/projects/:projectId/media/tasks/:taskId'],(req,res)=>{try{const task=own(req,res);if(task)res.json(media.snapshot(task));}catch(e){fail(res,e);}});
 app.post(['/api/media/tasks/:taskId/wait','/api/projects/:projectId/media/tasks/:taskId/wait'],async(req,res)=>{try{const task=own(req,res);if(!task)return;const controller=new AbortController();res.once('close',()=>controller.abort());const timeout=Math.min(120000,Math.max(1,Number(req.body?.timeoutMs)||30000));const timer=setTimeout(()=>controller.abort(),timeout);try{const result=await media.wait(task.id,controller.signal);if(!res.destroyed)res.json(result);}finally{clearTimeout(timer);}}catch(e){fail(res,e);}});
 app.delete(['/api/media/tasks/:taskId','/api/projects/:projectId/media/tasks/:taskId'],async(req,res)=>{try{const task=own(req,res);if(task)res.json(await media.cancel(task.id));}catch(e){fail(res,e);}});
 app.post(['/api/media/tasks/:taskId/cancel','/api/projects/:projectId/media/tasks/:taskId/cancel'],async(req,res)=>{try{const task=own(req,res);if(task)res.json(await media.cancel(task.id));}catch(e){fail(res,e);}});
 app.post(['/api/media/tasks/:taskId/retry','/api/projects/:projectId/media/tasks/:taskId/retry'],async(req,res)=>{try{const task=own(req,res);if(task){await deps.authorizeGeneration?.(task.projectId,{surface:task.surface});res.status(202).json(await media.retry(task.id));}}catch(e){fail(res,e);}});
 // Legacy image slot reads/retries are normalized onto the same durable media tasks.
 app.get(['/api/image-tasks/:taskId','/api/projects/:projectId/image-tasks/:taskId'],(req,res)=>{try{const task=own(req,res);if(!task)return;const file=task.file as {name?:string}|null;res.json({ok:true,task:{id:task.id,resolution:task.resolution,slots:[{slotId:task.slot?.id??task.id,variantIndex:1,status:task.status,path:file?.name,error:task.error?.message}],retryContext:{variants:[{prompt:task.prompt}]},...media.snapshot(task)}});}catch(e){fail(res,e);}});
 app.post(['/api/image-tasks/:taskId/slots/:slotId/retry','/api/projects/:projectId/image-tasks/:taskId/slots/:slotId/retry'],async(req,res)=>{try{const task=own(req,res);if(!task)return;if(req.params.slotId!==(task.slot?.id??task.id))throw new Error('Image slot not found');await deps.authorizeGeneration?.(task.projectId,{surface:task.surface});res.status(202).json({ok:true,...await media.retry(task.id)});}catch(e){fail(res,e);}});
}
