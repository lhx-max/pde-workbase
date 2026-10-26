import { createHash, randomUUID } from 'node:crypto';
import { validateMockupDocument,mockupDocumentPaths, imageConfigDefaults, validateImageConfig, validateTool, toolReferences, type ImageToolSpec, type ImageConfig } from '@ks-designai/image-card-pack/server';
import { CanvasStateError } from '../canvas/errors.js';
import type { CanvasStateService, CanvasStateSnapshot } from '../canvas/state.js';
import type { CanvasState } from '../canvas/persistence.js';
import type { MediaAdapterService } from './adapter-service.js';
import { callerScopedKey, verifiedCallerScope, type VerifiedCallerScope } from './request-identity.js';
type Item = Record<string, any>;
type ImageReceipt = {
    receiptId: string;
    actionId: string;
    digest: string;
    status: 'prepared' | 'accepted' | 'succeeded' | 'failed';
    nodeId: string;
    config: ImageConfig;
    taskIds: string[];
    nodeIds: string[];
    /** sha256 of the verified caller identity tuple; absent on legacy receipts. */
    callerScope?: string;
    error?: string;
    tool?: ImageToolSpec;
    editRevision?: number;
};
const object = (v: unknown): Item => v && typeof v === 'object' && !Array.isArray(v) ? v as Item : {};
const list = (v: unknown): Item[] => Array.isArray(v) ? v as Item[] : [];
const fail = (status: number, code: string, message: string): never => { throw new CanvasStateError(status, code, message); };
const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])) : v;
const id = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(v) ? v : fail(400, 'IMAGE_INVALID_INPUT', 'nodeId/taskId must be a bounded identifier');
/** Durable receipts map key: under a verified MA caller the raw idempotency key
 * is namespaced by the caller identity and project, so the same key on a shared
 * workspace never replays another caller's claim. Unverified callers keep the
 * raw key. The hash is opaque — no identity or credential reaches storage. */
const receiptKey = (projectId: string, scope: VerifiedCallerScope | undefined, key: string) =>
    scope ? callerScopedKey('irp', projectId, scope, key) : key;
const uuid = (seed: string) => { const h = createHash('sha256').update(seed).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; };
function config(state: CanvasState, nodeId: string): ImageConfig {
    const d = object(object(state.workbenchTaskDrafts)[nodeId]);
    const image = list(state.workbenchImages).find(v => v.id === nodeId), request = object(image?.mediaRequest);
    return { ...imageConfigDefaults, prompt: typeof d.text === 'string' ? d.text : request.prompt ?? image?.prompt ?? '', model: d.models?.[0] ?? request.model ?? image?.model ?? imageConfigDefaults.model, aspect: d.imageRatios?.[0] ?? d.imageRatio ?? request.aspect ?? image?.ratio ?? '1:1', resolution: d.imageResolution ?? request.resolution ?? image?.resolution ?? '2K', count: d.imageCount ?? 1, references: Array.isArray(d.attachments) ? list(d.attachments).filter(v => typeof v.path === 'string' && String(v.mimeType ?? '').startsWith('image/')).map(v => v.path) : Array.isArray(request.images) ? request.images : [] };
}
function findNode(state: CanvasState, nodeId: string): Item {
    return list(state.workbenchInstances).find(v => v.id === nodeId && v.kind === 'visual') ?? list(state.workbenchImages).find(v => v.id === nodeId) ?? fail(404, 'IMAGE_NODE_NOT_FOUND', 'Image card does not exist');
}
function withConfig(state: CanvasState, nodeId: string, value: ImageConfig): Item {
    const previous = object(object(state.workbenchTaskDrafts)[nodeId]), attachments = list(previous.attachments);
    return { ...object(state.workbenchTaskDrafts), [nodeId]: { ...previous, text: value.prompt, models: [value.model], imageRatio: value.aspect, imageRatios: [value.aspect], imageResolution: value.resolution, imageCount: value.count, attachments: [...attachments.filter(v => !String(v.mimeType ?? '').startsWith('image/')), ...value.references.map(path => attachments.find(v => v.path === path) ?? { path, name: path.split('/').pop(), mimeType: 'image/png', size: 0 })] } };
}
/** Image App host adapter. Only this projection uses canvas JSON; public callers
 * use App actions. Configuration and receipts persist with the cloud workspace. */
export class ImageAppService {
    private readonly locks = new Map<string, Promise<unknown>>();
    constructor(private readonly canvas: CanvasStateService, private readonly media: MediaAdapterService,private readonly edits?:{save:(projectId:string,path:string,document:unknown)=>Promise<void>;read:(projectId:string,path:string)=>Promise<unknown>;receipts?:{read:(projectId:string,key:string)=>Promise<unknown>;write:(projectId:string,key:string,receipt:unknown)=>Promise<void>};readArtifact?:(projectId:string,path:string)=>Promise<unknown>;validatePath:(projectId:string,path:string)=>Promise<void>}) { }
    private async serial<T>(projectId: string, work: () => Promise<T>): Promise<T> {
        const previous = this.locks.get(projectId) ?? Promise.resolve();
        const next = previous.catch(() => { }).then(work);
        this.locks.set(projectId, next);
        try {
            return await next;
        }
        finally {
            if (this.locks.get(projectId) === next)
                this.locks.delete(projectId);
        }
    }
    async tools() {
        if(!this.media.adapter?.tools)return {tools:[]};
        return this.media.adapter.tools();
    }
    async state(projectId: string) {
        const snapshot = await this.canvas.read(projectId), state = snapshot.state;
        const ids = [...new Set([...list(state.workbenchInstances).filter(v => v.kind === 'visual'), ...list(state.workbenchImages)].map(v => v.id as string))];
        return { instanceId: projectId, revision: snapshot.revision, cards: ids.map(nodeId => ({ nodeId, config: config(state, nodeId), node: findNode(state, nodeId) })) };
    }
    async artifact(projectId:string,path:string){if(!this.edits?.readArtifact)fail(503,'IMAGE_TOOL_ARTIFACT_UNAVAILABLE','JSON工具存储未配置');if(typeof path!=='string'||!path.startsWith('outputs/image-tools/')||!path.endsWith('.json'))fail(400,'IMAGE_TOOL_ARTIFACT_INVALID','Only project tool JSON artifacts are supported');return this.edits!.readArtifact!(projectId,path);}
    private source(state:CanvasState,nodeId:string):Item {
        const target=findNode(state,id(nodeId));
        const source=typeof target.path==='string'&&target.path?target:list(state.workbenchImages).find(v=>v.sourceInstanceId===nodeId&&v.embeddedInSource&&v.path);
        if(!source?.path)fail(409,'IMAGE_NOT_READY','图片尚未完成');return source!;
    }
    private editRevision(entry:Item){const revision=entry.revision??0;if(!Number.isSafeInteger(revision)||revision<0||revision>=Number.MAX_SAFE_INTEGER)fail(503,'IMAGE_EDIT_CORRUPT','工程版本无效');return revision as number;}
    async readEdit(projectId:string,nodeId:string){
        const snapshot=await this.canvas.read(projectId),source=this.source(snapshot.state,nodeId);
        const entry=object(object(snapshot.state.workbenchImageEdits)[nodeId]);
        if(!entry.path)return {nodeId,revision:snapshot.revision,sourcePath:source.path,editRevision:0,document:null};
        if(entry.sourcePath!==source.path)fail(409,'IMAGE_EDIT_SOURCE_CHANGED','原图已替换，旧工程不能覆盖当前图片');
        if(!this.edits)fail(503,'IMAGE_EDIT_UNAVAILABLE','云端工程存储未配置');
        const document=validateMockupDocument(await this.edits!.read(projectId,entry.path));
        if(document.basePath!==source.path)fail(503,'IMAGE_EDIT_CORRUPT','工程来源不一致');
        return {nodeId,revision:snapshot.revision,sourcePath:source.path,editRevision:this.editRevision(entry),document};
    }
    async status(projectId: string, nodeId: string) { const snapshot = await this.canvas.read(projectId); const node = findNode(snapshot.state, id(nodeId)); return { nodeId, revision: snapshot.revision, config: config(snapshot.state, nodeId), outputs: list(snapshot.state.workbenchImages).filter(v => v.id === nodeId || v.sourceInstanceId === nodeId), tasks: this.media.list(projectId, true).filter(t => t.lineage?.sourceNodeIds?.includes(nodeId) || t.taskId === node.taskId) }; }
    private render(projectId: string, snapshot: CanvasStateSnapshot, receipt: ImageReceipt) {
        const cloud = object(snapshot.state.workbenchImageTasks);
        const tasks = receipt.taskIds.map(taskId => { const t = this.media.get(taskId); return t?.projectId === projectId ? this.media.snapshot(t) : cloud[taskId] ?? { taskId, status: receipt.status === 'failed' ? 'not-submitted' : 'unknown' }; });
        const terminal = tasks.length > 0 && tasks.every(t => ['done', 'failed', 'interrupted'].includes(t.status) && t.canvasDelivery?.status !== 'pending');
        const unsuccessful = tasks.some(t => t.status !== 'done' || t.canvasDelivery?.status !== 'delivered' || t.canvasDelivery?.error);
        const status = receipt.actionId === 'image.cancel' ? receipt.status : receipt.status === 'failed' ? 'failed' : terminal ? unsuccessful ? 'failed' : 'succeeded' : receipt.status === 'prepared' ? 'accepted' : receipt.status;
        return { receiptId: receipt.receiptId, status, revision: snapshot.revision, result: { nodeId: receipt.nodeId, config: receipt.config, ...(receipt.editRevision!==undefined?{editRevision:receipt.editRevision}:{}), taskIds: receipt.taskIds, nodeIds: receipt.nodeIds, tasks, ...(receipt.error ? { error: receipt.error } : {}) } };
    }
    /** A scoped receipt is visible only to its own verified caller scope; an
     * unscoped caller, a different scope or background work gets 404. Legacy
     * unscoped receipts stay readable only in explicit unverified/local mode — this
     * is endpoint replay ownership, not whole-state secrecy. */
    async receipt(projectId: string, receiptId: string) {
        const scope = verifiedCallerScope();
        const s = await this.canvas.read(projectId); const receipts = object(s.state.workbenchImageReceipts);
        const candidates = scope ? [receiptKey(projectId, scope, receiptId), receiptId] : [receiptId];
        let r = candidates.map(k => Object.hasOwn(receipts, k) ? receipts[k] as ImageReceipt : undefined)
            .find(candidate => candidate && candidate.callerScope === scope?.hash);
        if(!r&&this.edits?.receipts){for(const key of candidates){const archived=await this.edits.receipts.read(projectId,key) as ImageReceipt|undefined;if(archived&&archived.callerScope===scope?.hash){r=archived;break;}}}
        if (!r)
            fail(404, 'IMAGE_RECEIPT_NOT_FOUND', 'Receipt not found'); return this.render(projectId, s, r!);
    }
    async action(projectId: string, actionId: string, input: Item, expectedRevision: unknown, key: unknown) {
        const scope=verifiedCallerScope();
        if(actionId==='image.edit.read'){if(Object.keys(input).some(k=>k!=='nodeId'))fail(400,'IMAGE_INVALID_INPUT','Unknown input field');return {status:'succeeded',result:await this.readEdit(projectId,id(input.nodeId))};}
        if (actionId === 'image.status') {
            if (Object.keys(input).some(k => k !== 'nodeId'))
                fail(400, 'IMAGE_INVALID_INPUT', 'Unknown input field');
            return { status: 'succeeded', result: await this.status(projectId, input.nodeId) };
        }
        return this.serial(projectId, async () => {
            if (typeof key !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(key))
                fail(428, 'IMAGE_IDEMPOTENCY_REQUIRED', 'Pass a bounded identifier as idempotency-key for image writes');
            const receiptId = key as string;
            const storageKey = receiptKey(projectId, scope, receiptId);
            const snapshot = await this.canvas.read(projectId), state = snapshot.state;
            const digest = createHash('sha256').update(JSON.stringify(stable({ actionId, input }))).digest('hex');
            const receipts = object(state.workbenchImageReceipts);
            const claimed = (Object.hasOwn(receipts, storageKey) ? receipts[storageKey] : await this.edits?.receipts?.read(projectId,storageKey)) as ImageReceipt|undefined;
            // A stored record only belongs to this claim when its caller scope
            // matches; a verified caller can never adopt an unscoped or foreign
            // receipt that happens to sit under the derived key.
            if(claimed&&claimed.callerScope!==scope?.hash)fail(503,'IMAGE_RECEIPT_SCOPE_MISMATCH','Stored receipt ownership does not match the claim');
            const existing = claimed;
            if (existing) {
                if (existing.digest !== digest)
                    fail(409, 'IMAGE_IDEMPOTENCY_CONFLICT', 'This key was used with different input');
                if (existing.status === 'prepared')
                    await this.dispatch(projectId, storageKey, existing);
                return { ...await this.receipt(projectId, receiptId), replayed: true };
            }
            if (!Number.isSafeInteger(expectedRevision))
                fail(428, 'IMAGE_REVISION_REQUIRED', 'expectedRevision is required');
            if (expectedRevision !== snapshot.revision)
                fail(409, 'CANVAS_REVISION_CONFLICT', 'Read the current image workspace revision before changing it');
            if (Object.keys(receipts).length >= 256 && !(actionId==='image.edit.save'&&this.edits?.receipts))
                fail(503, 'IMAGE_RECEIPT_CAPACITY', 'Image receipt capacity reached; archive the workspace before starting new actions');
            if(actionId==='image.edit.save'){
                if(Object.keys(input).some(k=>!['nodeId','document','expectedEditRevision'].includes(k)))fail(400,'IMAGE_INVALID_INPUT','Unknown edit input field');
                if(!this.edits)fail(503,'IMAGE_EDIT_UNAVAILABLE','云端工程存储未配置');
                const nodeId=id(input.nodeId),source=this.source(state,nodeId),document=validateMockupDocument(input.document);
                const editRevision=this.editRevision(object(object(state.workbenchImageEdits)[nodeId]));
                if(!Number.isSafeInteger(input.expectedEditRevision)||input.expectedEditRevision!==editRevision)fail(409,'IMAGE_EDIT_REVISION_CONFLICT','工程已更新，请重新读取后合并修改');
                if(document.basePath!==source.path)fail(409,'IMAGE_EDIT_SOURCE_CHANGED','工程来源与当前图片不一致');
                for(const path of mockupDocumentPaths(document))await this.edits!.validatePath(projectId,path);
                const path=`outputs/image-tools/edits/${createHash('sha256').update(JSON.stringify([projectId,storageKey,digest])).digest('hex')}.json`;
                await this.edits!.save(projectId,path,document);
                const nextReceipts={...receipts};
                if(this.edits!.receipts){for(const [key,value] of Object.entries(nextReceipts)){if(value.actionId==='image.edit.save'&&value.status==='succeeded'){await this.edits!.receipts.write(projectId,key,value);delete nextReceipts[key];}}}
                if(Object.keys(nextReceipts).length>=256)fail(503,'IMAGE_RECEIPT_CAPACITY','Image receipt capacity reached');
                const receipt:ImageReceipt={receiptId,actionId,digest,status:'succeeded',editRevision:editRevision+1,nodeId,config:config(state,nodeId),taskIds:[],nodeIds:[],...(scope?{callerScope:scope.hash}:{})};
                await this.canvas.patch(projectId,{workbenchImageEdits:{...object(state.workbenchImageEdits),[nodeId]:{path,sourcePath:source.path,revision:editRevision+1}},workbenchImageReceipts:{...nextReceipts,[storageKey]:receipt}},{expectedRevision:expectedRevision as number,imageAppWrite:true});
                return {...await this.receipt(projectId,receiptId),replayed:false};
            }
            const create = actionId === 'image.create', toolAction=actionId==='image.tool', generate = ['image.generate', 'image.regenerate','image.tool'].includes(actionId), cancel = actionId === 'image.cancel';
            if (!create && !generate && !cancel && actionId !== 'image.configure')
                fail(404, 'IMAGE_ACTION_NOT_FOUND', 'Unknown image action');
            const fields = create ? ['canvasId', 'nodeId', 'x', 'y', 'name', 'config'] : cancel ? ['nodeId', 'taskId'] : toolAction?['nodeId','kind','params','model']:['nodeId', 'set'];
            if (Object.keys(input).some(k => !fields.includes(k)))
                fail(400, 'IMAGE_INVALID_INPUT', 'Unknown image action input field');
            const nodeId = id(input.nodeId ?? (create ? `visual-${randomUUID()}` : undefined));
            let target: Item;
            if (create) {
                if (input.canvasId !== projectId || ![input.x, input.y].every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 10000000) || input.name !== undefined && (typeof input.name !== 'string' || input.name.length > 1000))
                    fail(400, 'IMAGE_INVALID_INPUT', 'Create requires matching canvasId, finite x/y and a bounded name');
                if ([...list(state.workbenchInstances), ...list(state.workbenchImages)].some(n => n.id === nodeId))
                    fail(409, 'IMAGE_NODE_EXISTS', 'Node already exists');
                target = { id: nodeId, kind: 'visual', x: input.x, y: input.y, label: input.name ?? '图片' };
            }
            else
                target = findNode(state, nodeId);
            let overrides: Partial<ImageConfig>;
            try {
                overrides = validateImageConfig((create ? input.config : input.set) === undefined ? {} : create ? input.config : input.set);
            }
            catch (e) {
                return fail(400, 'IMAGE_INVALID_CONFIG', e instanceof Error ? e.message : String(e));
            }
            if (actionId === 'image.configure' && !Object.keys(overrides).length)
                fail(400, 'IMAGE_INVALID_CONFIG', 'set must contain at least one configuration field');
            const settings = { ...config(state, nodeId), ...overrides };
            let tool:ImageToolSpec|undefined;
            if(toolAction){
                const source=typeof target.path==='string'&&target.path?target:list(state.workbenchImages).find(v=>v.sourceInstanceId===nodeId&&v.embeddedInSource&&v.path);
                if(!source?.path)fail(409,'IMAGE_NOT_READY','Image tools require an existing completed image');
                try{tool=validateTool({kind:input.kind,source:source!.path,params:input.params});}catch(error){fail(400,'IMAGE_TOOL_INPUT_INVALID',error instanceof Error?error.message:'Invalid tool');}
                if(tool!.kind==='mockup-surface')fail(503,'IMAGE_TOOL_ADAPTER_UNAVAILABLE','Mockup surface produces JSON-only output and has no image job adapter yet');
                settings.count=1;settings.references=toolReferences(tool!);
                if(input.model!==undefined)settings.model=input.model;
            }
            if (!cancel)
                try {
                    validateImageConfig(settings);
                }
                catch (e) {
                    return fail(400, 'IMAGE_INVALID_CONFIG', e instanceof Error ? e.message : String(e));
                }
            if (generate) {
                if (!toolAction && !settings.prompt.trim() && !settings.references.length)
                    fail(400, 'IMAGE_PROMPT_REQUIRED', 'Provide a prompt or reference images');
                if (!this.media.adapter)
                    fail(503, 'IMAGE_EXECUTOR_UNAVAILABLE', 'No image executor is configured');
                const catalog = await this.media.adapter!.catalog();
                if (!catalog.image.some(m => m.id === settings.model))
                    fail(400, 'IMAGE_MODEL_UNAVAILABLE', 'Model is not exposed by the configured executor');
                if (this.media.list(projectId, false).some(t => t.lineage?.sourceNodeIds?.includes(nodeId) && ['queued', 'running'].includes(t.status)))
                    fail(409, 'IMAGE_BUSY', 'This card already has active image tasks');
                if (Object.values(receipts).some(r => r.nodeId === nodeId && r.status === 'prepared' && ['image.generate', 'image.regenerate','image.tool'].includes(r.actionId)))
                    fail(409, 'IMAGE_BUSY', 'Replay the pending receipt before starting another image batch');
            }
            if (cancel) {
                const task = this.media.get(id(input.taskId));
                if (!task || task.projectId !== projectId || !task.lineage?.sourceNodeIds?.includes(nodeId) && task.id !== target.taskId)
                    fail(404, 'IMAGE_TASK_NOT_FOUND', 'Task does not belong to this image card');
            }
            const taskIds = generate ? Array.from({ length: settings.count }, (_, i) => `canvas-${uuid(`${projectId}\0${storageKey}\0${i}`)}`) : cancel ? [input.taskId as string] : [];
            const nodeIds = generate ? taskIds.map(t => `img-slot-media-${t}`) : [];
            const receipt: ImageReceipt = { receiptId, actionId, digest, status: generate || cancel ? 'prepared' : 'succeeded', nodeId, config: settings, taskIds, nodeIds, ...(tool?{tool}:{}), ...(scope ? { callerScope: scope.hash } : {}) };
            let images = list(state.workbenchImages);
            if (generate) {
                const embedded = list(state.workbenchInstances).some(v => v.id === nodeId) && !images.some(v => v.sourceInstanceId === nodeId && v.embeddedInSource && v.path);
                images = images.filter(v => !(v.sourceInstanceId === nodeId && v.embeddedInSource && !v.path && v.status === 'failed'));
                images = [...images, ...taskIds.map((taskId, i) => ({ id: nodeIds[i], name: `${settings.model}-${i + 1}.png`, x: Number(target.x) + 480 + i * 400, y: Number(target.y), status: 'generating', taskId, slotId: `media-${taskId}`, sourceInstanceId: nodeId, embeddedInSource: embedded && i === 0, assetKind: 'generated', ratio: settings.aspect, resolution: settings.resolution, model: settings.model, outputIndex: i + 1 }))];
            }
            const changes: CanvasState = { workbenchImageReceipts: { ...receipts, [storageKey]: receipt } };
            if (!cancel&&!toolAction) {
                const drafts = withConfig(state, nodeId, settings);
                if (generate)
                    drafts[nodeId] = { ...drafts[nodeId], activeImageTasks: taskIds.map((taskId, i) => ({ taskId, nativeMedia: true, backendOwned: true, embedInSource: images.find(v => v.id === nodeIds[i])?.embeddedInSource ?? false, models: [settings.model], modelId: settings.model, ratio: settings.aspect, resolution: settings.resolution, outputPath: `outputs/images/${taskId}.png`, startedAt: Date.now() })) };
                changes.workbenchTaskDrafts = drafts;
            }
            if (create)
                changes.workbenchInstances = [...list(state.workbenchInstances), target];
            if (generate)
                changes.workbenchImages = images;
            await this.canvas.patch(projectId, changes, { expectedRevision: expectedRevision as number, imageAppWrite: true });
            if (generate || cancel)
                await this.dispatch(projectId, storageKey, receipt);
            return { ...await this.receipt(projectId, receiptId), replayed: false };
        });
    }
    private async dispatch(projectId: string, storageKey: string, receipt: ImageReceipt) {
        try {
            if (receipt.actionId === 'image.cancel')
                await this.media.cancel(receipt.taskIds[0]!);
            else
                for (const [i, taskId] of receipt.taskIds.entries()) {
                    const saved = await this.canvas.read(projectId), cloud = object(saved.state.workbenchImageTasks);
                    // An executor journal loss is not permission to charge the user again.
                    if (!this.media.get(taskId) && cloud[taskId])
                        continue;
                    const output = `outputs/images/${taskId}.${receipt.tool?.kind === 'vectorize' ? 'svg' : 'png'}`;
                    await this.media.submit(projectId, { surface: 'image', model: receipt.config.model, prompt: receipt.config.prompt, aspect: receipt.config.aspect, resolution: receipt.config.resolution, images: receipt.config.references, ...(receipt.tool?{tool:receipt.tool}:{}), output, clientRequestId: taskId.slice(7), canvasDelivery: { nodeId: receipt.nodeIds[i], kind: 'image', basePath: '', baseVersion: '', fileUrl: `/api/projects/${encodeURIComponent(projectId)}/files/${output}` }, slot: { id: `media-${taskId}`, kind: 'canvas-image', label: `图片 ${i + 1}` }, lineage: { sourceNodeIds: [receipt.nodeId],...(receipt.tool?{sourceAssetPath:receipt.tool.source}:{}) } });
                }
            await this.updateReceipt(projectId, storageKey, { status: receipt.actionId === 'image.cancel' ? 'succeeded' : 'accepted' });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Image executor rejected the request';
            await this.updateReceipt(projectId, storageKey, { status: 'failed', error: message });
            await this.canvas.updateMediaState(projectId, state => ({ ...state, workbenchImages: list(state.workbenchImages).map(v => receipt.nodeIds.includes(v.id) && !this.media.get(v.taskId) && !v.path ? { ...v, status: 'failed', error: message } : v) }));
        }
    }
    private async updateReceipt(projectId: string, key: string, patch: Partial<ImageReceipt>) { await this.canvas.updateMediaState(projectId, state => { const receipts = object(state.workbenchImageReceipts); return { ...state, workbenchImageReceipts: { ...receipts, [key]: { ...object(receipts[key]), ...patch } } }; }); }
}
