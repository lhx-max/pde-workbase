// Adapted from Bezier/Loom 319e5eee, Apache-2.0. Injected standalone SQLite core.
import type { Database } from "../storage/database.js";
import { extractAssetImageMetadata } from './image-metadata.js';
import { createHash, randomUUID } from "node:crypto";
import type {
  PersonalAsset,
  AssetLibraryCreateRequest,
  AssetLibrarySpacesPatch,
  PersonalAssetBatchAction,
  PersonalAssetCreate,
  PersonalAssetKind,
  PersonalAssetPatch,
  PersonalAssetUse,
  PersonalAssetVersion,
} from "@bezier/contracts";

const KINDS: PersonalAssetKind[] = [
  "folder",
  "text",
  "script",
  "image",
  "video",
  "audio",
  "slides",
  "webpage",
  "motion",
  "file",
];
function metadataText(value: unknown): string {
  if(value === undefined) return '';
  if(typeof value !== 'string' || value.length > 4000) throw new PersonalAssetError(400, '风格和使用场景最多 4000 字。');
  return value;
}
export class PersonalAssetError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
function fail(message: string): never {
  throw new PersonalAssetError(400, message);
}
/** Ratings are numeric integers, never coerced from transport values. */
function ratingOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 5)
    fail('评分必须是 0 到 5 的整数。');
  return value;
}
function nameOf(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() || value.trim() === "." || value.trim() === ".." ||
    value.length > 200 ||
    /[\x00-\x1f/\\]/.test(value)
  )
    fail("名称不能为空，且不能包含路径分隔符（最多 200 字）。");
  return value.trim();
}
function sourceOf(
  value: PersonalAssetCreate["source"],
): PersonalAsset["source"] {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("来源信息无效。");
  const result: PersonalAsset["source"] = {};
  for (const key of ["url", "projectId", "filename", "nodeId"] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== "string" || value[key]!.length > 4000)
        fail("来源信息无效。");
      result[key] = value[key];
    }
  }
  if (result.url && !/^https?:\/\//i.test(result.url))
    fail("只接受 HTTP 或 HTTPS 来源链接。");
  if (value.template) {
    const t = value.template;
    if (typeof t.id !== 'string' || !t.id || !/^[\w./-]+$/.test(t.id) || t.id.includes('..') ||
      !['Prototype','Slides','Image','Video','HyperFrames','Audio'].includes(t.type) ||
      t.referencePath !== `design-templates/${t.id}/TEMPLATE.md`) fail('模板来源无效。');
    for (const url of [t.posterSrc, t.previewSrc, t.previewVideo]) {
      if (url != null && (typeof url !== 'string' || url.length > 4000 || /[\\\x00-\x1f]/.test(url) || !/^\/(?!\/)/.test(url))) fail('模板预览地址无效。');
    }
    result.template = { id:t.id, type:t.type, referencePath:t.referencePath, posterSrc:t.posterSrc, previewSrc:t.previewSrc, previewVideo:t.previewVideo };
  }
  return result;
}
export function inferPersonalAssetKind(
  filename: string,
  mime: string,
): PersonalAssetKind {
  if (
    mime.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(filename)
  )
    return "image";
  if (mime.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(filename))
    return "video";
  if (mime.startsWith("audio/") || /\.(mp3|wav|m4a|ogg|flac)$/i.test(filename))
    return "audio";
  if (/\.(pptx?|odp)$/i.test(filename)) return "slides";
  if (/\.html?$/i.test(filename)) return "webpage";
  if (/\.(txt|md)$/i.test(filename)) return "text";
  if (/\.storyboard\.json$/i.test(filename)) return "script";
  return "file";
}

/** Uses only the injected independent library database; transactions serialize local writers.
 * Deduplicated blobs survive version changes; permanent deletion purges unreferenced bytes. */
type AssetFile = { bytes: Buffer; filename: string; mime: string };
export interface PersonalAssetService {
  readSpaces(scope: string): { folders: {id:string;name:string;createdAt:number}[]; initialized:boolean };
  patchSpaces(scope: string, input: AssetLibrarySpacesPatch): ReturnType<PersonalAssetService['readSpaces']>;
  importTemplate(input: PersonalAssetCreate & { description?: string; tags?: string[]; style?: string; usage?: string }): PersonalAsset;
  importTemplates(inputs: PersonalAssetCreate[]): PersonalAsset[];
  indexImages(): Promise<void>;
  whenIdle(): Promise<void>;
  list(): PersonalAsset[];
  deletionTargets(ids: string[]): PersonalAsset[];
  remove(ids: string[], templateIds?: string[]): PersonalAsset[];
  read(id: string): PersonalAsset;
  create(input: AssetLibraryCreateRequest, file?: AssetFile): PersonalAsset;
  patch(id: string, patch: PersonalAssetPatch): PersonalAsset;
  version(id: string, file: AssetFile, revision?: number): PersonalAsset;
  content(
    id: string,
    versionId?: string,
  ): { asset: PersonalAsset; version: PersonalAssetVersion; bytes: Buffer };
  batch(
    ids: string[],
    action: PersonalAssetBatchAction | 'restore',
    patch?: PersonalAssetPatch,
  ): PersonalAsset[];
  uses(id: string): PersonalAssetUse[];
  recordUse(id: string, use: PersonalAssetUse): void;
}
export function createPersonalAssetService(
  db: Database,
): PersonalAssetService {
  const atomic = <A extends unknown[], R>(fn: (...args:A)=>R) => db.transaction(fn).immediate;
  db.pragma("busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS personal_assets (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS asset_library_captures (scope TEXT NOT NULL, capture_id TEXT NOT NULL, digest TEXT NOT NULL, asset_id TEXT NOT NULL, PRIMARY KEY(scope,capture_id));
    CREATE TABLE IF NOT EXISTS personal_asset_spaces (scope TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS asset_library_removed_spaces (space_id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS personal_asset_template_baselines (source_id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS personal_asset_imports (source_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS personal_asset_blobs (hash TEXT PRIMARY KEY, bytes BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS personal_asset_uses (asset_id TEXT NOT NULL, project_id TEXT NOT NULL, filename TEXT NOT NULL, version_id TEXT NOT NULL, used_at INTEGER NOT NULL, PRIMARY KEY(asset_id, project_id, filename, version_id));`);
  const read = (id: string): PersonalAsset => {
    const row = db
      .prepare("SELECT body FROM personal_assets WHERE id = ?")
      .get(id) as { body: string } | undefined;
    if (!row) throw new PersonalAssetError(404, "资产不存在。");
    return JSON.parse(row.body);
  };
  let indexing: Promise<void> | undefined;
  function indexImages(): Promise<void> {
    if (indexing) return indexing;
    indexing = (async () => {
      const pending = list().filter(a => !a.deletedAt && a.kind === 'image' && a.versions.length && !a.versions.at(-1)?.imageMetadata).slice(0,20);
      for(const asset of pending) {
        const version = asset.versions.at(-1)!;
        const row = db.prepare('SELECT bytes FROM personal_asset_blobs WHERE hash = ?').get(version.hash) as {bytes:Buffer}|undefined;
        const metadata = row ? await extractAssetImageMetadata(Buffer.from(row.bytes)) : { colors:[],status:'unsupported' as const };
        // Re-read after decoding: preserve edits/deletes/uploads made while indexing.
        atomic(() => {
          const current = list().find(candidate => candidate.id === asset.id);
          if (!current) return; // Deleted while decoding.
          const target = current.versions.find(v=>v.id===version.id);
          if(target) { target.imageMetadata=metadata; put(current); }
        })();
      }
    })().finally(()=>{indexing=undefined;});
    return indexing;
  }
  const list = (): PersonalAsset[] =>
    (
      db.prepare("SELECT body FROM personal_assets").all() as { body: string }[]
    ).map((r) => JSON.parse(r.body));
  const put = (asset: PersonalAsset) => {
    db.prepare(
      "INSERT OR REPLACE INTO personal_assets (id, body) VALUES (?, ?)",
    ).run(asset.id, JSON.stringify(asset));
    return asset;
  };
  // Retire catalog-generated tags once. A changed tag list is user-owned.
  // Keep the original rows for recovery, including the old import baseline.
  db.exec('CREATE TABLE IF NOT EXISTS personal_asset_template_tag_cleanup (source_id TEXT PRIMARY KEY, original_body TEXT NOT NULL, original_baseline TEXT NOT NULL)');
  atomic(() => {
    const rows = db.prepare('SELECT i.source_id, a.body, b.body AS baseline FROM personal_asset_imports i JOIN personal_assets a ON a.id=i.asset_id JOIN personal_asset_template_baselines b ON b.source_id=i.source_id LEFT JOIN personal_asset_template_tag_cleanup c ON c.source_id=i.source_id WHERE c.source_id IS NULL').all() as {source_id:string;body:string;baseline:string}[];
    for (const row of rows) {
      const asset = JSON.parse(row.body) as PersonalAsset;
      const baseline = JSON.parse(row.baseline) as PersonalAsset;
      if (!baseline.source.template?.referencePath.startsWith('design-templates/')) continue;
      db.prepare('INSERT INTO personal_asset_template_tag_cleanup VALUES (?,?,?)').run(row.source_id,row.body,row.baseline);
      if (asset.tags.length && JSON.stringify(asset.tags) === JSON.stringify(baseline.tags))
        put({...asset,tags:[],revision:asset.revision+1,updatedAt:Date.now()});
      db.prepare('UPDATE personal_asset_template_baselines SET body=? WHERE source_id=?').run(JSON.stringify({...baseline,tags:[]}),row.source_id);
    }
  })();
  function deletionTargets(ids: string[]): PersonalAsset[] {
    if (!Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some(id => typeof id !== 'string' || !id))
      fail('请选择 1–500 个资产。');
    const selected = new Set(ids);
    const all = list();
    let changed = true;
    while (changed) {
      changed = false;
      for (const asset of all) if (asset.parentId && selected.has(asset.parentId) && !selected.has(asset.id)) {
        selected.add(asset.id); changed = true;
      }
    }
    return all.filter(asset => selected.has(asset.id));
  }
  const remove = atomic((ids: string[], templateIds: string[] = []): PersonalAsset[] => {
    const sources = new Set(templateIds);
    const selected = new Set(ids);
    for (const asset of list()) if (asset.source.template && sources.has(asset.source.template.id)) selected.add(asset.id);
    // No public batch limit on the expanded package/subtree closure.
    const all = list();
    let changed = true;
    while (changed) {
      changed = false;
      for (const asset of all) if (asset.parentId && selected.has(asset.parentId) && !selected.has(asset.id)) {
        selected.add(asset.id); changed = true;
      }
    }
    const removed = all.filter(asset => selected.has(asset.id));
    for (const asset of removed) {
      if (asset.source.template) sources.add(asset.source.template.id);
      db.prepare('DELETE FROM personal_assets WHERE id=?').run(asset.id);
      db.prepare('DELETE FROM personal_asset_uses WHERE asset_id=?').run(asset.id);
      for (const table of ['personal_asset_upload_repairs', 'personal_asset_space_repairs'])
        db.prepare(`DELETE FROM ${table} WHERE id=?`).run(asset.id);

    }
    for (const source of sources) {
      db.prepare('DELETE FROM personal_asset_imports WHERE source_id=?').run(source);
      db.prepare('DELETE FROM personal_asset_template_baselines WHERE source_id=?').run(source);
      db.prepare('DELETE FROM personal_asset_template_tag_cleanup WHERE source_id=?').run(source);
    }
    const retained = new Set(list().flatMap(asset => asset.versions.map(version => version.hash)));
    for (const row of db.prepare('SELECT body FROM personal_asset_template_baselines').all() as {body:string}[])
      for (const version of (JSON.parse(row.body) as PersonalAsset).versions) retained.add(version.hash);
    for (const row of db.prepare('SELECT hash FROM personal_asset_blobs').all() as {hash:string}[])
      if (!retained.has(row.hash)) db.prepare('DELETE FROM personal_asset_blobs WHERE hash=?').run(row.hash);
    return removed;
  });
  function assertActive(asset: PersonalAsset) {
    if (asset.deletedAt) fail('资产已删除。');
  }
  function parentOf(parent: unknown, self?: string): string | null {
    if (parent == null) return null;
    if (typeof parent !== "string") fail("文件夹无效。");
    let current: string | null = parent;
    const seen = new Set<string>(self ? [self] : []);
    while (current) {
      if (seen.has(current)) fail("不能将文件夹移入自身或其子文件夹。");
      seen.add(current);
      const node = read(current);
      assertActive(node);
      if (node.kind !== "folder") fail("目标不是文件夹。");
      current = node.parentId;
    }
    return parent;
  }
  /** Historical unknown IDs remain valid. Only explicit removals prevent late
   * writes; capture receipts are checked before this guard, so retries can still
   * return the original asset after an atomic space move.
   */
  function writableSpace(value: unknown): string {
    const id = nameOf(value);
    if (db.prepare('SELECT 1 FROM asset_library_removed_spaces WHERE space_id=?').get(id))
      throw new PersonalAssetError(409, 'Asset space was removed; select a remaining space');
    return id;
  }
  function checkRevision(asset: PersonalAsset, revision?: number) {
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) fail("版本号无效。");
    if (revision !== undefined && revision !== asset.revision)
      throw new PersonalAssetError(
        409,
        "资产已被其他窗口修改，请重新打开后再保存。",
      );
  }
  function blob(
    bytes: Buffer,
    filename: string,
    mime: string,
  ): PersonalAssetVersion {
    if (!Buffer.isBuffer(bytes)) fail("请提供文件字节。");
    nameOf(filename);
    if (typeof mime !== "string") fail("文件类型无效。");
    if (bytes.length > 200 * 1024 * 1024) fail("单个文件最大 200 MB。");
    const hash = createHash("sha256").update(bytes).digest("hex");
    db.prepare(
      "INSERT OR IGNORE INTO personal_asset_blobs (hash, bytes) VALUES (?, ?)",
    ).run(hash, bytes);
    const inferred: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
      svg: "image/svg+xml",
      avif: "image/avif",
      mp4: "video/mp4",
      webm: "video/webm",
      mov: "video/quicktime",
      mp3: "audio/mpeg",
      wav: "audio/wav",
      m4a: "audio/mp4",
      ogg: "audio/ogg",
      flac: "audio/flac",
      html: "text/html",
      htm: "text/html",
      md: "text/plain",
      txt: "text/plain",
      json: "application/json",
      pdf: "application/pdf",
    };
    const contentType =
      !mime || mime === "application/octet-stream"
        ? inferred[filename.split(".").at(-1)?.toLowerCase() || ""] ||
          "application/octet-stream"
        : mime;
    return {
      id: randomUUID(),
      hash,
      filename: nameOf(filename),
      mime: /^[\w.+-]+\/[\w.+-]+$/.test(contentType)
        ? contentType
        : "application/octet-stream",
      size: bytes.length,
      createdAt: Date.now(),
    };
  }
  function createInner(
    input: PersonalAssetCreate,
    file?: { bytes: Buffer; filename: string; mime: string },
  ): PersonalAsset {
    if (!input || typeof input !== "object") fail("请提供资产信息。");
    if (!KINDS.includes(input.kind)) fail("资产类型无效。");
    const rating = input.rating === undefined ? 0 : ratingOf(input.rating);
    const name = nameOf(input.name),
      now = Date.now();
    if(input.description!==undefined&&(typeof input.description!=='string'||input.description.length>4000))fail('描述最多 4000 字。');
    if(input.tags!==undefined&&(!Array.isArray(input.tags)||input.tags.length>30||input.tags.some(t=>typeof t!=='string'||t.length>80)))fail('标签无效。');
    if (
      input.content !== undefined &&
      (typeof input.content !== "string" ||
        Buffer.byteLength(input.content, "utf8") > 4 * 1024 * 1024)
    )
      fail("文本最大 4 MB。");
    if (input.kind === "folder" && file) fail("文件夹不能包含文件内容。");
    if (
      input.kind !== "folder" &&
      !file &&
      !["text", "script", "webpage", "slides", "motion"].includes(input.kind)
    )
      fail("请上传文件，或从画板保存生成结果。");
    const ext =
      input.kind === "script"
        ? ".storyboard.json"
        : ["webpage", "slides", "motion"].includes(input.kind)
          ? ".html"
          : ".md";
    const mime =
      ext === ".html"
        ? "text/html"
        : input.kind === "script"
          ? "application/json"
          : "text/plain";
    const versions =
      input.kind === "folder"
        ? []
        : [
            file
              ? blob(file.bytes, file.filename, file.mime)
              : blob(
                  Buffer.from(input.content ?? ""),
                  name.endsWith(ext) ? name : name + ext,
                  mime,
                ),
          ];
    return put({
      id: randomUUID(),
      owner: "local-personal",
      name,
      kind: input.kind,
      parentId: parentOf(input.parentId),
      ...(input.spaceId !== undefined ? { spaceId: writableSpace(input.spaceId) } : {}),
      description: input.description || "",
      style: metadataText(input.style),
      usage: metadataText(input.usage),
      tags: [...new Set((input.tags || []).map(t=>t.trim()).filter(Boolean))],
      favorite: false,
      rating,
      source: sourceOf(input.source),
      versions,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      revision: 1,
    });
  }
  function patchInner(id: string, patch: PersonalAssetPatch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch))
      fail("修改信息无效。");
    const asset = read(id);
    assertActive(asset);
    checkRevision(asset, patch.revision);
    if (patch.spaceId !== undefined) asset.spaceId = writableSpace(patch.spaceId);
    if (patch.name !== undefined) asset.name = nameOf(patch.name);
    if (patch.prompt !== undefined) {
      const prompt = patch.prompt;
      if (!prompt || typeof prompt.text !== 'string' || !prompt.text.trim() || prompt.text.length > 12000
        || prompt.versionId !== asset.versions.at(-1)?.id || !Number.isFinite(prompt.generatedAt))
        fail('Prompt 内容或资产版本无效。');
      asset.prompt = { text: prompt.text.trim(), versionId: prompt.versionId, generatedAt: prompt.generatedAt };
    }
    if (patch.style !== undefined) asset.style = metadataText(patch.style);
    if (patch.usage !== undefined) asset.usage = metadataText(patch.usage);
    if ("parentId" in patch) asset.parentId = parentOf(patch.parentId, id);
    if (patch.description !== undefined) {
      if (
        typeof patch.description !== "string" ||
        patch.description.length > 4000
      )
        fail("描述最大 4000 字。");
      asset.description = patch.description;
    }
    if (patch.tags !== undefined) {
      if (
        !Array.isArray(patch.tags) ||
        patch.tags.length > 30 ||
        patch.tags.some((t) => typeof t !== "string" || t.length > 80)
      )
        fail("标签最多 30 个，每个最多 80 字。");
      asset.tags = [
        ...new Set(patch.tags.map((t) => t.trim()).filter(Boolean)),
      ];
    }
    if (patch.favorite !== undefined) {
      if (typeof patch.favorite !== "boolean") fail("收藏参数无效。");
      asset.favorite = patch.favorite;
    }
    if (patch.rating !== undefined) asset.rating = ratingOf(patch.rating);
    return put({
      ...asset,
      revision: asset.revision + 1,
      updatedAt: Date.now(),
    });
  }
  const service: PersonalAssetService = {
    readSpaces(scope: string): {folders:{id:string;name:string;createdAt:number}[];initialized:boolean} {
      const row = db.prepare('SELECT body FROM personal_asset_spaces WHERE scope=?').get(nameOf(scope)) as {body:string}|undefined;
      return { folders: row ? JSON.parse(row.body) : [], initialized: Boolean(row) };
    },
    patchSpaces: atomic((scope: string, input: AssetLibrarySpacesPatch) => {
      if (!input || !Array.isArray(input.upsert) || !Array.isArray(input.remove) || input.upsert.length > 1000 || input.remove.length > 1000) fail('空间数据无效');
      if (input.removeContents !== undefined && typeof input.removeContents !== 'boolean') fail('Invalid removeContents');
      const folders = new Map(service.readSpaces(scope).folders.map(folder => [folder.id, folder]));
      const removedSpaces = new Set(input.remove.map(nameOf));
      if (removedSpaces.has('default-project')) fail('The default space cannot be removed');
      const all = list();
      // Space IDs are the shared namespace on assets; scopes only group the UI
      // records. Remember known removals without banning historical unknown IDs.
      const knownRemoved = [...removedSpaces].filter(id => folders.has(id) || all.some(asset => asset.spaceId === id));
      for (const id of removedSpaces) folders.delete(id);
      for (const folder of input.upsert) {
        if (!folder || !Number.isFinite(folder.createdAt) || folder.id === 'default-project') fail('空间数据无效');
        const id = writableSpace(folder.id);
        if (removedSpaces.has(id)) fail('A space cannot be upserted and removed together');
        folders.set(id, {id,name:nameOf(folder.name),createdAt:folder.createdAt});
      }
      const targetSpaceId = writableSpace(input.targetSpaceId === undefined ? 'default-project' : input.targetSpaceId);
      if (removedSpaces.has(targetSpaceId) || (targetSpaceId !== 'default-project' && !folders.has(targetSpaceId))) fail('Select a remaining target space');
      const selected = new Set(all.filter(asset => removedSpaces.has(asset.spaceId ?? 'default-project')).map(asset => asset.id));
      // Preserve folder-tree integrity even when historical descendants have a
      // different or absent space ID; neither mode leaves parent or space orphans.
      let changed = true;
      while (changed) {
        changed = false;
        for (const asset of all) if (asset.parentId && selected.has(asset.parentId) && !selected.has(asset.id)) {
          selected.add(asset.id); changed = true;
        }
      }
      if (input.removeContents === true) {
        if (selected.size) remove([...selected]);
      } else {
        const byId = new Map(all.map(asset => [asset.id, asset]));
        for (const asset of all) if (selected.has(asset.id)) {
          const parent = asset.parentId ? byId.get(asset.parentId) : undefined;
          const parentId = asset.parentId && (selected.has(asset.parentId) || (parent && (parent.spaceId ?? 'default-project') === targetSpaceId)) ? asset.parentId : null;
          put({...asset,spaceId:targetSpaceId,parentId,revision:asset.revision+1,updatedAt:Date.now()});
        }
      }
      for (const id of knownRemoved) db.prepare('INSERT OR IGNORE INTO asset_library_removed_spaces(space_id) VALUES (?)').run(id);
      db.prepare('INSERT OR REPLACE INTO personal_asset_spaces(scope,body) VALUES (?,?)').run(nameOf(scope), JSON.stringify([...folders.values()]));
      return service.readSpaces(scope);
    }),
    importTemplate: atomic((input: PersonalAssetCreate & { description?: string; tags?: string[]; style?: string; usage?: string }) => {
      if (!input || typeof input !== 'object') fail('模板信息无效。');
      const source = sourceOf(input.source);
      if (!source.template) fail('缺少模板来源。');
      if (source.template.referencePath.startsWith('design-templates/')) input = {...input,tags:[]};
      const existing = db.prepare('SELECT asset_id FROM personal_asset_imports WHERE source_id = ?').get(source.template.id) as {asset_id:string}|undefined;
      const baselineRow = db.prepare('SELECT body FROM personal_asset_template_baselines WHERE source_id=?').get(source.template.id) as {body:string}|undefined;
      const baseline = baselineRow ? JSON.parse(baselineRow.body) as PersonalAsset : undefined;
      if (existing) {
        const current = read(existing.asset_id);
        if (current.deletedAt) return current;
        const nextVersion = blob(Buffer.from(input.content || ''), 'template-prompt.md', 'text/plain');
        const next = {...current};
        const upstream = {...current, name:input.name, description:input.description || '', tags:input.tags || [], style:input.style || '', usage:input.usage || '', source, versions:[nextVersion]};
        for (const key of ['name','description','tags','style','usage','source'] as const) {
          if (baseline && JSON.stringify(current[key]) === JSON.stringify(baseline[key])) Object.assign(next, {[key]:upstream[key]});
        }
        const oldHash = baseline?.versions.at(-1)?.hash ?? current.versions[0]?.hash;
        if (current.versions.at(-1)?.hash === oldHash && oldHash !== nextVersion.hash) next.versions = [...current.versions, nextVersion];
        db.prepare('INSERT OR REPLACE INTO personal_asset_template_baselines(source_id,body) VALUES (?,?)').run(source.template.id, JSON.stringify(upstream));
        return JSON.stringify(next) === JSON.stringify(current) ? current : put({...next, revision:current.revision+1, updatedAt:Date.now()});
      }
      const kinds = { Prototype:'webpage', Slides:'slides', Image:'image', Video:'video', HyperFrames:'motion', Audio:'audio' } as const;
      const created = createInner({ ...input, kind:kinds[source.template.type], spaceId:'default-project', parentId:null, source },
        { bytes:Buffer.from(input.content || ''), filename:'template-prompt.md', mime:'text/plain' });
      const asset = patchInner(created.id, {description:input.description || '',tags:input.tags || [],style:input.style || '',usage:input.usage || '',revision:created.revision});
      db.prepare('INSERT INTO personal_asset_imports (source_id, asset_id) VALUES (?, ?)').run(source.template.id,asset.id);
      db.prepare('INSERT INTO personal_asset_template_baselines(source_id,body) VALUES (?,?)').run(source.template.id,JSON.stringify(asset));
      return asset;
    }),
    importTemplates: atomic((inputs: PersonalAssetCreate[]) => {
      if (!Array.isArray(inputs) || inputs.length > 1000) fail('模板列表无效。');
      return inputs.map(input => service.importTemplate(input));
    }),
    indexImages,
    whenIdle: () => indexing ?? Promise.resolve(),
    list,
    deletionTargets,
    remove,
    read,
    create: atomic((input: AssetLibraryCreateRequest, file?: AssetFile) => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail('请提供资产信息。');
      if (input.captureId === undefined) return createInner(input, file);
      const captureId = input.captureId;
      if (typeof captureId !== 'string' || !/^[\w.:-]{1,200}$/.test(captureId)) fail('Invalid captureId');
      const scope = sourceOf(input.source).projectId ?? 'local';
      // Stable JSON ordering makes retries independent of transport key order.
      const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])) : value;
      const {captureId: _capture, execution: _execution, executionRequired: _required, aiFill: _aiFill, ...metadata} = input;
      const digest = createHash('sha256').update(JSON.stringify(stable({metadata,file:file?{filename:file.filename,mime:file.mime,hash:createHash('sha256').update(file.bytes).digest('hex')}:null}))).digest('hex');
      const previous = db.prepare('SELECT digest, asset_id FROM asset_library_captures WHERE scope=? AND capture_id=?').get(scope,captureId) as {digest:string;asset_id:string}|undefined;
      if (previous) {
        if (previous.digest !== digest) throw new PersonalAssetError(409,'Capture request changed; use a new captureId');
        const existing = list().find(asset=>asset.id===previous.asset_id);
        if (!existing) throw new PersonalAssetError(409,'Captured asset was permanently deleted');
        return existing;
      }
      const asset = createInner(input,file);
      db.prepare('INSERT INTO asset_library_captures(scope,capture_id,digest,asset_id) VALUES (?,?,?,?)').run(scope,captureId,digest,asset.id);
      return asset;
    }),
    patch: atomic(patchInner),
    version: atomic(
      (
        id: string,
        file: { bytes: Buffer; filename: string; mime: string },
        revision?: number,
      ) => {
        const asset = read(id);
        assertActive(asset);
        checkRevision(asset, revision);
        if (asset.kind === "folder") fail("文件夹没有内容版本。");
        const next = blob(file.bytes, file.filename, file.mime);
        if (next.hash === asset.versions.at(-1)?.hash) return asset;
        return put({
          ...asset,
          versions: [...asset.versions, next],
          revision: asset.revision + 1,
          updatedAt: Date.now(),
        });
      },
    ),
    content(id: string, versionId?: string) {
      const asset = read(id);
      const version = versionId
        ? asset.versions.find((v) => v.id === versionId)
        : asset.versions.at(-1);
      if (!version) throw new PersonalAssetError(404, "内容版本不存在。");
      const data = db
        .prepare("SELECT bytes FROM personal_asset_blobs WHERE hash = ?")
        .get(version.hash) as { bytes: Buffer } | undefined;
      if (!data) throw new PersonalAssetError(404, "资产文件不存在。");
      return { asset, version, bytes: Buffer.from(data.bytes) };
    },
    batch: atomic(
      (
        ids: string[],
        action: PersonalAssetBatchAction | 'restore',
        patch: PersonalAssetPatch = {},
      ) => {
        if (action === 'restore') fail('不再支持恢复；删除为永久操作。');
        if (action === 'delete' || action === 'trash') {
          const targets = deletionTargets(ids);
          if (patch?.revision !== undefined) for (const id of ids) checkRevision(read(id), patch.revision);
          return remove(ids, targets.flatMap(asset => asset.source.template ? [asset.source.template.id] : []));
        }
        if (!patch || typeof patch !== "object" || Array.isArray(patch))
          fail("批量修改信息无效。");
        if (
          !Array.isArray(ids) ||
          ids.length < 1 ||
          ids.length > 500 ||
          ids.some((id) => typeof id !== "string")
        )
          fail("请选择 1–500 个资产。");
        if (
          !["move", "copy", "tag", "favorite"].includes(
            action,
          )
        )
          fail("操作无效。");
        if (patch.spaceId !== undefined) writableSpace(patch.spaceId);
        for (const id of ids) checkRevision(read(id), patch.revision);
        const all = list(),
          selected = new Set(ids);
        // A selected child is handled together with its selected ancestor, once.
        const roots = [...selected].filter((id) => {
          let p = read(id).parentId;
          while (p) {
            if (selected.has(p)) return false;
            p = read(p).parentId;
          }
          return true;
        });
        const result: PersonalAsset[] = [];
        const children = (id: string): PersonalAsset[] =>
          all.filter((a) => a.parentId === id);
        function visit(id: string, parent?: string | null) {
          const a = read(id);
          if (action === "copy") {
            assertActive(a);
            const target =
              parent !== undefined ? parent : parentOf(patch.parentId);
            const copy = put({
              ...a,
              id: randomUUID(),
              name:
                parent === undefined ? `${a.name.slice(0, 190)} 副本` : a.name,
              parentId: target,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              revision: 1,
            });
            result.push(copy);
            children(id)
              .filter((c) => !c.deletedAt)
              .forEach((c) => visit(c.id, copy.id));
          } else
            result.push(
              patchInner(
                id,
                action === "move"
                  ? { parentId: patch.parentId ?? null }
                  : action === "tag"
                    ? { tags: patch.tags ?? [] }
                    : { favorite: patch.favorite ?? true },
              ),
            );
        }
        (["copy", "move"].includes(action)
          ? roots
          : [...selected]
        ).forEach((id) => visit(id));
        return result;
      },
    ),
    uses: (id: string): PersonalAssetUse[] => {
      read(id);
      return db
        .prepare(
          "SELECT project_id AS projectId, filename, version_id AS versionId, used_at AS usedAt FROM personal_asset_uses WHERE asset_id = ? ORDER BY used_at DESC",
        )
        .all(id) as PersonalAssetUse[];
    },
    recordUse(id: string, use: PersonalAssetUse) {
      const asset = read(id);
      assertActive(asset);
      if (
        !use ||
        !asset.versions.some((v) => v.id === use.versionId) ||
        typeof use.projectId !== "string" ||
        !use.projectId ||
        typeof use.filename !== "string" ||
        !use.filename
      )
        fail("使用记录无效。");
      db.prepare(
        "INSERT OR REPLACE INTO personal_asset_uses VALUES (?, ?, ?, ?, ?)",
      ).run(
        id,
        use.projectId.slice(0, 200),
        use.filename.slice(0, 1000),
        use.versionId,
        Date.now(),
      );
    },
  };
  // Repair the old upload route which used the display name as the stored
  // filename. Keep a receipt containing the original record for recovery.
  db.exec('CREATE TABLE IF NOT EXISTS personal_asset_upload_repairs (id TEXT PRIMARY KEY, original_body TEXT NOT NULL)');
  atomic(() => {
    for (const asset of list()) {
      const sourceName = asset.source.filename?.split('/').pop();
      const version = asset.versions.at(-1);
      if (asset.deletedAt || asset.kind !== 'file' || !sourceName || !version || version.filename !== asset.name || sourceName === version.filename) continue;
      const recoveredKind = inferPersonalAssetKind(sourceName, version.mime);
      if (recoveredKind === 'file') continue;
      db.prepare('INSERT OR IGNORE INTO personal_asset_upload_repairs VALUES (?, ?)').run(asset.id, JSON.stringify(asset));
      try { nameOf(sourceName); } catch { continue; }
      version.filename = sourceName;
      put({ ...asset, kind: recoveredKind, revision: asset.revision + 1 });
    }
  })();
  // Repair only unambiguous legacy upload folders. Preserve an original-body receipt.
  db.exec('CREATE TABLE IF NOT EXISTS personal_asset_space_repairs (id TEXT PRIMARY KEY, original_body TEXT NOT NULL)');
  atomic(() => {
    const rows = list();
    const descendants = (id:string, seen=new Set<string>()): PersonalAsset[] => {
      if(seen.has(id)) return [];
      seen.add(id);
      return rows.filter(a=>!a.deletedAt && a.parentId===id).flatMap(a=>a.kind==='folder'?descendants(a.id,seen):[a]);
    };
    for(const folder of rows.filter(a=>!a.deletedAt && a.kind==='folder' && !a.spaceId)) {
      const children=descendants(folder.id);
      const spaces=new Set(children.map(a=>a.spaceId || 'default-project'));
      if(spaces.size!==1 || !children.length) continue;
      const spaceId=[...spaces][0]!;
      if(spaceId==='default-project') continue;
      db.prepare('INSERT OR IGNORE INTO personal_asset_space_repairs VALUES (?,?)').run(folder.id,JSON.stringify(folder));
      put({...folder,spaceId,revision:folder.revision+1,updatedAt:Date.now()});
    }
  })();
  return service;
}
