// Adapted from Bezier/Loom 319e5eee: original injected asset-core regression suite.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "../src/storage/database.js";
import sharp from 'sharp';
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersonalAssetService } from "../src/asset-library/core.js";

describe("personal asset library", () => {
  it('clears legacy catalog tags once and preserves manually changed tags', () => {
    for (const edited of [false, true]) {
      const id = `legacy-${edited}`;
      const asset = store.importTemplate({name:id,kind:'text',source:{template:{id,type:'Slides',referencePath:`design-templates/${id}/TEMPLATE.md`,posterSrc:null,previewSrc:null,previewVideo:null}}});
      const baseline = {...asset,tags:['deck','consulting']};
      db.prepare('UPDATE personal_assets SET body=? WHERE id=?').run(JSON.stringify({...baseline,tags:edited?['我的标签']:baseline.tags}),asset.id);
      db.prepare('UPDATE personal_asset_template_baselines SET body=? WHERE source_id=?').run(JSON.stringify(baseline),id);
      const reopened = createPersonalAssetService(db);
      expect(reopened.read(asset.id).tags).toEqual(edited?['我的标签']:[]);
      reopened.patch(asset.id,{tags:['新手动标签']});
      expect(createPersonalAssetService(db).read(asset.id).tags).toEqual(['新手动标签']);
    }
  });
  it('repairs a legacy folder only when its children agree on the space', () => {
    const folder=store.create({name:'上传目录',kind:'folder'});
    store.create({name:'正文',kind:'text',parentId:folder.id,spaceId:'brand'});
    const reopened=createPersonalAssetService(db);
    expect(reopened.read(folder.id).spaceId).toBe('brand');
    expect(db.prepare('SELECT original_body FROM personal_asset_space_repairs WHERE id=?').get(folder.id)).toBeTruthy();
    const mixed=reopened.create({name:'混合目录',kind:'folder'});
    reopened.create({name:'甲',kind:'text',parentId:mixed.id,spaceId:'brand'});
    reopened.create({name:'乙',kind:'text',parentId:mixed.id,spaceId:'other'});
    expect(createPersonalAssetService(db).read(mixed.id).spaceId).toBeUndefined();
  });
  it('persists empty spaces across service restart and keeps scopes separate', () => {
    store.patchSpaces('local',{upsert:[{id:'brand',name:'品牌',createdAt:1}],remove:[]});
    const reopened=createPersonalAssetService(db);
    expect(reopened.readSpaces('local').folders[0]?.name).toBe('品牌');
    expect(reopened.readSpaces('other').initialized).toBe(false);
    reopened.patchSpaces('local',{upsert:[],remove:['brand']});
    expect(reopened.readSpaces('local')).toEqual({folders:[],initialized:true});
  });
  it('updates upstream template fields but preserves user content, names and space', () => {
    const input={name:'模板',kind:'text' as const,content:'v1',description:'old',tags:['旧标签'],style:'旧风格',usage:'旧场景',source:{template:{id:'sync',type:'Slides' as const,referencePath:'design-templates/sync/TEMPLATE.md',posterSrc:null,previewSrc:null,previewVideo:null}}};
    const first=store.importTemplate(input);
    store.patch(first.id,{name:'我的名字',spaceId:'brand',revision:first.revision});
    const updated=store.importTemplate({...input,name:'官方新名字',content:'v2',description:'new',tags:['新标签'],style:'新风格',usage:'新场景'});
    expect(updated.name).toBe('我的名字');
    expect(updated.spaceId).toBe('brand');
    expect(updated.description).toBe('new');
    expect(updated.tags).toEqual([]);
    expect(updated.style).toBe('新风格');
    expect(updated.usage).toBe('新场景');
    expect(store.content(first.id).bytes.toString()).toBe('v2');
    const edited=store.version(first.id,{filename:'template-prompt.md',mime:'text/plain',bytes:Buffer.from('我的正文')},updated.revision);
    store.importTemplate({...input,content:'v3'});
    expect(store.content(first.id).bytes.toString()).toBe('我的正文');
    expect(store.read(first.id).versions).toEqual(edited.versions);
  });
  it('repairs legacy display-name uploads without losing bytes or repeating repairs', () => {
    const original = store.create({name:'镜头脚本',kind:'file',source:{filename:'镜头脚本.storyboard.json'}}, {filename:'镜头脚本',mime:'application/json',bytes:Buffer.from('{"shots":[]}')});
    const repaired=createPersonalAssetService(db).read(original.id);
    expect(repaired.kind).toBe('script');
    expect(repaired.versions.at(-1)?.filename).toBe('镜头脚本.storyboard.json');
    expect(store.content(original.id).bytes.toString()).toBe('{"shots":[]}');
    expect(createPersonalAssetService(db).read(original.id).revision).toBe(repaired.revision);
    expect(db.prepare('SELECT original_body FROM personal_asset_upload_repairs WHERE id=?').get(original.id)).toBeTruthy();
  });
  it('imports templates once and preserves edits, copies, moves and deletion across restart', () => {
    const input = {name:'示例网页',kind:'webpage' as const,content:'原提示词',tags:['品牌'],source:{template:{id:'example',type:'Prototype' as const,referencePath:'design-templates/example/TEMPLATE.md',posterSrc:'/api/poster.png',previewSrc:'/api/skills/example/example',previewVideo:null}}};
    const asset=store.importTemplate(input);
    expect(asset.spaceId).toBe('default-project');
    expect(store.content(asset.id).bytes.toString()).toBe('原提示词');
    const updated=store.patch(asset.id,{name:'我的网页',favorite:true,rating:4,spaceId:'space-123',revision:asset.revision});
    const reopened=createPersonalAssetService(db);
    expect(reopened.importTemplate(input)).toEqual(updated);
    const copied=reopened.batch([asset.id],'copy')[0]!;
    expect(copied.id).not.toBe(asset.id);
    expect(copied.source.template).toEqual(asset.source.template);
    reopened.batch([asset.id],'trash');
    expect(reopened.list()).toEqual([]);
    expect(createPersonalAssetService(db).list()).toEqual([]);
    expect(db.prepare('SELECT * FROM personal_asset_imports').all()).toEqual([]);
  });
  it('rejects an unsafe installed-template preview without creating a record', () => {
    expect(() => store.importTemplate({name:'bad',kind:'text',source:{template:{id:'bad',type:'Image',referencePath:'design-templates/bad/TEMPLATE.md',posterSrc:'javascript:alert(1)',previewSrc:null,previewVideo:null}}})).toThrow();
    expect(store.list()).toEqual([]);
  });
  let db: Database,
    store: ReturnType<typeof createPersonalAssetService>,
    dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "da-assets-test-"));
    db = new Database(join(dir, "db.sqlite"));
    store = createPersonalAssetService(db);
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const folder = (name = "folder") => store.create({ name, kind: "folder" });
  it('persists space assignment and rejects stale moves', () => {
    const asset = store.create({ name: 'Space asset', kind: 'text', spaceId: 'business-a' });
    expect(createPersonalAssetService(db).read(asset.id).spaceId).toBe('business-a');
    store.patch(asset.id, { spaceId: 'business-b', revision: asset.revision });
    expect(createPersonalAssetService(db).read(asset.id).spaceId).toBe('business-b');
    expect(() => store.patch(asset.id, { spaceId: 'business-a', revision: asset.revision })).toThrow();
    expect(() => store.create({ name: 'Invalid', kind: 'text', spaceId: '' })).toThrow();
  });
  it.each([undefined, 0, 1, 2, 3, 4, 5])('atomically creates and persists rating %s', (rating) => {
    const asset = store.create({ name: 'Rated', kind: 'text', content: 'body', ...(rating === undefined ? {} : { rating }) });
    expect(asset).toMatchObject({ rating: rating ?? 0, revision: 1 });
    expect(createPersonalAssetService(db).read(asset.id).rating).toBe(rating ?? 0);
  });
  it.each([-1, 6, 1.5, NaN, Infinity, null, '4', '', true, [], [4], {}].map(rating => ({ rating })))('rejects invalid creation rating $rating without storing assets or blobs', ({ rating }) => {
    expect(() => store.create({ name: 'Invalid', kind: 'text', rating: rating as number }, {
      bytes: Buffer.from('not stored'), filename: 'note.txt', mime: 'text/plain',
    })).toThrow('评分');
    expect(store.list()).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM personal_asset_blobs').get()).toEqual({ count: 0 });
  });
  it('persists and clears ratings; rejects invalid and stale updates', () => {
    const a = folder();
    const saved = store.patch(a.id, { rating: 4, revision: a.revision });
    expect(createPersonalAssetService(db).read(a.id).rating).toBe(4);
    expect(() => store.patch(a.id, { rating: 2, revision: a.revision })).toThrow();
    for (const rating of [-1, 6, 1.5, NaN, Infinity, null, '4', '', true, [], [4], {}]) {
      expect(() => store.patch(a.id, {rating: rating as number})).toThrow('评分');
      expect(store.read(a.id)).toEqual(saved);
    }
    store.patch(a.id, {rating: 0, revision: saved.revision});
    expect(store.read(a.id).rating).toBe(0);
  });
  it('persists image metadata without overwriting concurrent edits and reindexes replacements', async () => {
    const bytes=await sharp({create:{width:80,height:40,channels:3,background:'#00ff00'}}).png().toBuffer();
    const asset=store.create({name:'image',kind:'image'},{bytes,filename:'image.png',mime:'image/png'});
    const pending=store.indexImages();
    store.patch(asset.id,{name:'Renamed',tags:['green'],revision:asset.revision});
    await pending;
    const saved=createPersonalAssetService(db).read(asset.id);
    expect(saved.name).toBe('Renamed');expect(saved.tags).toEqual(['green']);
    expect(saved.versions.at(-1)?.imageMetadata?.width).toBe(80);
    store.version(asset.id,{bytes:Buffer.from('broken'),filename:'bad.png',mime:'image/png'},saved.revision);
    await store.indexImages();
    expect(store.read(asset.id).versions.at(-1)?.imageMetadata?.status).toBe('unsupported');
    expect(store.read(asset.id).versions[0]?.imageMetadata?.width).toBe(80);
  });
  it("persists content and metadata across restart without path identity", () => {
    const parent = folder(),
      a = store.create({
        name: "中文文案",
        kind: "text",
        content: "你好",
        parentId: parent.id,
      });
    store.patch(a.id, {
      name: "新名字",
      tags: ["品牌", "品牌"],
      favorite: true,
      parentId: null,
    });
    db.close();
    db = new Database(join(dir, "db.sqlite"));
    store = createPersonalAssetService(db);
    expect(store.read(a.id)).toMatchObject({
      name: "新名字",
      tags: ["品牌"],
      favorite: true,
      parentId: null,
    });
    expect(store.content(a.id).bytes.toString()).toBe("你好");
  });
  it("preserves immutable versions and rejects a stale editor", () => {
    const a = store.create({ name: "稿", kind: "text", content: "v1" });
    const b = store.version(
      a.id,
      { bytes: Buffer.from("v2"), filename: "稿.md", mime: "text/plain" },
      a.revision,
    );
    expect(b.versions).toHaveLength(2);
    expect(store.content(a.id, a.versions[0]!.id).bytes.toString()).toBe("v1");
    expect(() =>
      store.patch(a.id, { name: "stale", revision: a.revision }),
    ).toThrow("其他窗口");
    expect(() =>
      store.version(
        a.id,
        { bytes: Buffer.from("lost"), filename: "稿.md", mime: "text/plain" },
        a.revision,
      ),
    ).toThrow();
  });
  it("permanently deletes a subtree, its versions and unreferenced bytes", () => {
    const p = folder();
    const a = store.create({ name: 'new', kind: 'text', content: 'private', parentId: p.id });
    const keep = store.create({ name: 'keep', kind: 'text', content: 'shared' });
    store.create({ name: 'same bytes', kind: 'text', content: 'shared', parentId: p.id });
    store.batch([p.id, a.id], 'trash'); // old clients must also delete permanently
    expect(store.list()).toEqual([keep]);
    expect(() => store.content(a.id)).toThrow('不存在');
    expect(store.content(keep.id).bytes.toString()).toBe('shared');
    expect(db.prepare('SELECT count(*) AS count FROM personal_asset_blobs').get()).toEqual({count:1});
    expect(() => store.batch([p.id], 'restore')).toThrow();
  });
  it("rejects recursive moves and rolls back the complete batch", () => {
    const p = folder(),
      child = store.create({ name: "child", kind: "folder", parentId: p.id }),
      other = folder("other");
    expect(() =>
      store.batch([other.id, p.id], "move", { parentId: child.id }),
    ).toThrow();
    expect(store.read(other.id).parentId).toBeNull();
    expect(() => store.patch(p.id, { parentId: p.id })).toThrow();
  });
  it("copies folders once, reuses immutable bytes, and edits independently", () => {
    const p = folder(),
      a = store.create({
        name: "file",
        kind: "text",
        content: "same",
        parentId: p.id,
      });
    const copies = store.batch([p.id, a.id], "copy");
    expect(copies).toHaveLength(2);
    expect(copies[1]!.parentId).toBe(copies[0]!.id);
    expect(copies[1]!.versions[0]!.hash).toBe(a.versions[0]!.hash);
    store.version(copies[1]!.id, {
      bytes: Buffer.from("new"),
      filename: "file.md",
      mime: "text/plain",
    });
    expect(store.content(a.id).bytes.toString()).toBe("same");
  });
  it("validates unsafe names, input kinds, parents and metadata", () => {
    expect(() => store.create({ name: "../secret", kind: "text" })).toThrow();
    expect(() => store.create({ name: "x", kind: "image" })).toThrow();
    const a = store.create({ name: "x", kind: "text" });
    expect(() => store.patch(a.id, { parentId: a.id })).toThrow();
    expect(() =>
      store.patch(a.id, { tags: [1] as unknown as string[] }),
    ).toThrow();
    expect(() =>
      store.create({
        name: "bad",
        kind: "text",
        source: { url: "javascript:alert(1)" },
      }),
    ).toThrow();
  });
  it("deletes stored reuse metadata and content permanently", () => {
    const a = store.create({
      name: "x",
      kind: "text",
      content: "project snapshot",
    });
    store.recordUse(a.id, {
      projectId: "p",
      filename: "x.md",
      versionId: a.versions[0]!.id,
      usedAt: 0,
    });
    store.batch([a.id], "trash");
    expect(() => store.uses(a.id)).toThrow('不存在');
    expect(() => store.content(a.id)).toThrow('不存在');
    expect(db.prepare('SELECT * FROM personal_asset_uses').all()).toEqual([]);
  });
});
