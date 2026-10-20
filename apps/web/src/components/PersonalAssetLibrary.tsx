// Adapted from Bezier 319e5eee; original catalogue markup/styles, neutral local host ports.
import { AssetEditButton, AssetDeleteSelection, AssetFilterPopover } from './AssetManagementTools';
import { AssetDetailDialog, AssetDetailBody, AssetDetailInspector, AssetDetailSection } from './AssetDetailDialog';
import { AssetContentPreview, AssetPreviewDialog, personalAssetPreviewSource } from './AssetContentPreview';
import { AssetAnalysisFields } from './AssetAnalysisFields';
import { AssetSpaceField, AssetRatingField } from './AssetMetadataControls';
import { AssetTagPicker } from "./AssetTagPicker";
import { AssetFilterFields } from './AssetFilterFields';
import { emptyAssetFilters, matchesAssetFilters, type AssetFilters } from './asset-filters';
import { personalAssetTagsFrom } from './asset-library/personal-asset-tags';
import { WorkspaceEmptyState } from './WorkspaceEmptyState';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  PERSONAL_ASSET_CHANGED_EVENT,
  PERSONAL_ASSET_DRAG_MIME,
  PERSONAL_ASSET_DROP_EVENT,
  type PersonalAsset,
  type PersonalAssetKind,
} from "@bezier/contracts";
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Select,
  SegmentedControl,
  SegmentedControlItem,
  Textarea,
} from "@/src/components/ui";
import { Icon } from "./Icon";
import { Toast } from "./Toast";
import { personalAssetTemplate, templateImport } from './personal-asset-template';
import { type TemplateDemo } from './asset-ui-ports';
import { AssetSearchField } from "./AssetSearchField";
import {
  CollectionCard,
  CollectionCardMediaMeta,
  CollectionCardMediaActions,
} from "./CollectionCard";
import { PersonalAssetCardPreview } from "./PersonalAssetCardPreview";
import { NaturalMasonry } from './asset-library/NaturalMasonry';
import {
  personalAssets,
  readPersonalAssetUrl,
  usePersonalAssetInProject,
} from "../providers/asset-library";
import styles from "./PersonalAssetLibrary.module.css";

import { assetKindLabel } from './AssetMetadataReadOnly';
import { useI18n, useT } from '../i18n';
import { formatAppDate } from '../utils/app-date';
import { useAssetLibraryCapabilities } from './asset-library/use-asset-library-capabilities';
const editable = (a: PersonalAsset) =>
  (Boolean(personalAssetTemplate(a)) || ["text", "script", "webpage", "motion", "slides"].includes(a.kind)) &&
  /^(text\/|application\/json)/.test(a.versions.at(-1)?.mime || "");
type FormState = {
  mode: "create" | "edit" | "move" | "tag";
  kind: PersonalAssetKind;
  name: string;
  description: string;
  tags: string;
  content: string;
  parentId: string | null;
  asset?: PersonalAsset;
  ids?: string[];
  chooseKind?: boolean;
  file?: File;
  entryMethod?: "input" | "upload";
  url?: string;
};
const fileKinds = new Set<PersonalAssetKind>([
  "image",
  "video",
  "audio",
  "file",
]);
const acceptedFiles: Partial<Record<PersonalAssetKind, string>> = {
  image: "image/*,.png,.jpg,.jpeg,.webp,.gif,.avif,.svg",
  video: "video/*,.mp4,.webm,.mov",
  audio: "audio/*,.mp3,.wav,.m4a,.ogg,.flac",
  text: ".txt,.md",
  script: ".json",
  slides: ".ppt,.pptx,.odp,.html,.htm",
  webpage: ".html,.htm",
  motion: ".html,.htm",
};
function matchesFileKind(file: File, kind: PersonalAssetKind) {
  if (
    ["image", "video", "audio"].includes(kind) &&
    file.type &&
    file.type !== "application/octet-stream"
  )
    return file.type.startsWith(`${kind}/`);
  if (kind === "file")
    return (
      !/^(image|video|audio)\//.test(file.type) &&
      !/\.(png|jpe?g|webp|gif|avif|svg|mp4|webm|mov|mp3|wav|m4a|ogg|flac|pptx?|odp|html?|txt|md|storyboard\.json)$/i.test(
        file.name,
      )
    );
  return (acceptedFiles[kind] || "")
    .split(",")
    .some((part) =>
      part.endsWith("/*")
        ? file.type.startsWith(part.slice(0, -1))
        : file.name.toLowerCase().endsWith(part),
    );
}
function readSourceFile(file: File, t: (key: any, vars?: Record<string, string | number>) => string): Promise<string> {
  if (file.size > 4 * 1024 * 1024)
    return Promise.reject(new Error(t('entry.personalAssets.error.over4mb')));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(String(reader.result || "").replace(/^\uFEFF/, ""));
    reader.onerror = () => reject(new Error(t('entry.personalAssets.error.readFile')));
    reader.readAsText(file, "utf-8");
  });
}
function initialContent(kind: PersonalAssetKind, t: (key: any, vars?: Record<string, string | number>) => string) {
  if (kind === "script")
    return JSON.stringify(
      {
        title: t('entry.personalAssets.sample.scriptTitle'),
        shots: [
          {
            id: "shot-1",
            durationSec: 3,
            description: "",
            shotSize: t('entry.personalAssets.sample.shotSize'),
            cameraMovement: t('entry.personalAssets.sample.camera'),
          },
        ],
      },
      null,
      2,
    );
  if (["webpage", "slides", "motion"].includes(kind))
    return t('entry.personalAssets.sample.htmlSeed');
  return "";
}

/** One personal catalogue for the full page and the canvas picker. */
export function PersonalAssetLibrary({
  conversationSelection,
  installedTemplates,
  onUseTemplate,
  onUseAsset,
  editModeTools,
  catalogueTools,
  toolbarContainer,
  compact = false,
  viewerOnly = false,
  projectId,
  onRefreshFiles,
  kindFilter,
  onKindChange,
  spaceId,
  allContent = false,
  projectSpaceIds,
  spaceOptions,
  hideEmpty = false,
  searchValue,
  onSearchChange,
}: {
  conversationSelection?: import('./asset-ui-ports').AssetLibrarySelection;
  toolbarContainer?: HTMLElement | null;
  editModeTools?: ReactNode;
  /** Optional catalogue/design tooling supplied by the host; never implies AI support. */
  catalogueTools?: ReactNode;
  installedTemplates?: TemplateDemo[];
  onUseTemplate?: (template: TemplateDemo) => void;
  onUseAsset?: (asset: {name:string;url:string;prompt?:string;kind?:string}) => void | Promise<void>;
  compact?: boolean;
  /** Host-owned project write permission; personal metadata remains local. */
  viewerOnly?: boolean;
  projectId?: string;
  onRefreshFiles?: () => void | Promise<void>;
  kindFilter?: string;
  onKindChange?: (kind: string) => void;
  spaceId?: string;
  allContent?: boolean;
  projectSpaceIds?: Record<string, string>;
  spaceOptions?: { id: string; name: string }[];
  hideEmpty?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
}) {
  // This catalogue owns local assets. Authorization/execution belongs to the host.
  const workspaceContext = null;
  const workspaceContextLoading = false;
  const t = useT();
  const { locale } = useI18n();
  const labels = useMemo(() => ({
    folder: assetKindLabel('folder', t),
    text: assetKindLabel('text', t),
    script: assetKindLabel('script', t),
    image: assetKindLabel('image', t),
    video: assetKindLabel('video', t),
    audio: assetKindLabel('audio', t),
    slides: assetKindLabel('slides', t),
    webpage: assetKindLabel('webpage', t),
    motion: assetKindLabel('motion', t),
    file: assetKindLabel('file', t),
  } as Record<PersonalAssetKind, string>), [t]);
  const [assets, setAssets] = useState<PersonalAsset[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false),
    busyRef = useRef(false);
  const [parentId, setParentId] = useState<string | null>(null);
  const [view, setView] = useState<"all" | "favorite" | "recent">(
    "all",
  );
  const [localKind, setLocalKind] = useState("all"),
    [localQuery, setLocalQuery] = useState(""),
    [sort, setSort] = useState("updated");
  const kind = kindFilter ?? localKind;
  const query = searchValue ?? localQuery;
  const setQuery = (value: string) => { setLocalQuery(value); onSearchChange?.(value); };
  const setKind = (value: string) => {
    setLocalKind(value);
    onKindChange?.(value);
  };
  const [selected, setSelected] = useState<string[]>([]),
    [form, setForm] = useState<FormState | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [preview, setPreview] = useState<PersonalAsset | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [assetFilters, setAssetFilters] = useState<AssetFilters>(emptyAssetFilters);
  const activeFilterCount = Object.values(assetFilters).filter(Boolean).length
    + Number(Boolean(tagFilter))
    + Number(view !== 'all')
    + Number(kindFilter === undefined && kind !== 'all');
  const availableTags = personalAssetTagsFrom(assets);
  function saveDetail(field: "name" | "description" | "style" | "usage", value: string) {
    if (!preview || busyRef.current) return;
    const next = field === "name" ? value.trim() : value;
    if (field === "name" && !next) { setError(t('entry.personalAssets.error.nameRequired')); return; }
    if (next === preview[field]) return;
    const current = preview;
    void act(async () => {
      const result = await personalAssets.patch(current.id, { [field]: next, revision: current.revision });
      setPreview(asset => asset?.id === current.id ? result.asset : asset);
    }, t('entry.personalAssets.notice.saved'));
  }
  function saveTags(tags: string[]) {
    if (!preview || busyRef.current) return;
    const current = preview;
    void act(async () => {
      const result = await personalAssets.patch(current.id, { tags, revision: current.revision });
      setPreview(value => value?.id === current.id ? result.asset : value);
      setTagDraft("");
    }, t('entry.personalAssets.notice.tagsSaved'));
  }
  function addTag(value: string) {
    if (!preview) return;
    const tags = [...new Set([...preview.tags, ...value.split(/[,，\n]/).map((part) => part.trim()).filter(Boolean)])];
    if (tags.length !== preview.tags.length) saveTags(tags);
    else setTagDraft("");
  }
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null),
    replaceRef = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const capabilities = useAssetLibraryCapabilities();
  const refresh = useCallback(async () => {
    const ticket = ++generation.current;
    try {
      if (capabilities.catalogue && installedTemplates?.length) await personalAssets.importTemplates(installedTemplates.map(templateImport));
      const result = await personalAssets.list();
      if (ticket === generation.current) {
        setAssets(result.assets);
        setPreview(current => current ? result.assets.find(a=>a.id===current.id && !a.deletedAt) || null : null);
        setError("");
      }
    } catch (e) {
      if (ticket === generation.current)
        setError(e instanceof Error ? e.message : t('entry.personalAssets.error.loadFailed'));
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }, [installedTemplates, capabilities.catalogue]);
  useEffect(() => {
    if (!capabilities.info?.capabilities.imageMetadata) return;
    if (!assets.some(a=>!a.deletedAt && a.kind==='image' && a.versions.length && !a.versions.at(-1)?.imageMetadata)) return;
    const timer = setTimeout(()=>void refresh(),3000);
    return ()=>clearTimeout(timer);
  }, [assets,refresh,capabilities.info?.capabilities.imageMetadata]);
  useEffect(()=>setSelected([]),[assetFilters]);
  useEffect(() => {
    void refresh();
    const update = () => void refresh();
    window.addEventListener(PERSONAL_ASSET_CHANGED_EVENT, update);
    window.addEventListener("focus", update);
    const visibleUpdate = () => { if (document.visibilityState !== 'hidden') update(); };
    const refreshTimer = window.setInterval(visibleUpdate, 15_000);
    window.addEventListener('online', visibleUpdate);
    document.addEventListener('visibilitychange', visibleUpdate);
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel(PERSONAL_ASSET_CHANGED_EVENT);
      channel.onmessage = update;
    } catch {
      /* optional */
    }
    return () => {
      generation.current++;
      window.removeEventListener(PERSONAL_ASSET_CHANGED_EVENT, update);
      window.removeEventListener("focus", update);
      window.clearInterval(refreshTimer);
      window.removeEventListener('online', visibleUpdate);
      document.removeEventListener('visibilitychange', visibleUpdate);
      channel?.close();
    };
  }, [refresh]);
  useEffect(() => {
    setSelected([]);
  }, [view, parentId, query, kind, tagFilter]);
  useEffect(() => {
    if (parentId && !assets.some((a) => a.id === parentId && !a.deletedAt))
      setParentId(null);
  }, [assets, parentId]);
  const act = useCallback(
    async (work: () => Promise<unknown>, message: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError("");
      setNotice("");
      try {
        await work();
        await refresh();
        setNotice(message);
      } catch (e) {
        setError(e instanceof Error ? e.message : t('entry.personalAssets.error.actionFailed'));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [refresh, t],
  );
  const useAsset = useCallback(
    (asset: PersonalAsset, point?: { clientX: number; clientY: number }) => {
      if (!projectId || viewerOnly || workspaceContextLoading) return;
      void act(async () => {
        await usePersonalAssetInProject(
          asset,
          projectId,
          workspaceContext,
          point,
        );
        await onRefreshFiles?.();
      }, t('entry.personalAssets.notice.addedToBoard'));
    },
    [
      act,
      projectId,
      workspaceContext,
      viewerOnly,
      workspaceContextLoading,
      onRefreshFiles,
    ],
  );
  useEffect(() => {
    if (!projectId) return;
    const drop = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.projectId !== projectId) return;
      const asset = assets.find((a) => a.id === detail.id && !a.deletedAt);
      if (asset) useAsset(asset, detail);
    };
    window.addEventListener(PERSONAL_ASSET_DROP_EVENT, drop);
    return () => window.removeEventListener(PERSONAL_ASSET_DROP_EVENT, drop);
  }, [assets, projectId, useAsset]);
  const path = useMemo(() => {
    const result: PersonalAsset[] = [];
    let id = parentId;
    while (id) {
      const a = assets.find((row) => row.id === id);
      if (!a || result.some((r) => r.id === id)) break;
      result.unshift(a);
      id = a.parentId;
    }
    return result;
  }, [assets, parentId]);
  const assetSpaceId = (asset: PersonalAsset) => asset.spaceId || (asset.source.projectId && projectSpaceIds?.[asset.source.projectId]) || 'default-project';
  const creationSpaceId = (targetParent: string | null) => {
    if (!allContent) return spaceId;
    const folder = assets.find(asset => asset.id === targetParent);
    return folder ? assetSpaceId(folder) : 'default-project';
  };
  const visible = assets
    .filter((a) => {
      if (a.deletedAt) return false;
      if (spaceId && assetSpaceId(a) !== spaceId) return false;
      if (!matchesAssetFilters(a,assetFilters)) return false;
      if (tagFilter && !a.tags.includes(tagFilter)) return false;
      if (view === "favorite" && !a.favorite) return false;
      if ((!allContent || parentId) && view === "all" && !query && !tagFilter && !Object.values(assetFilters).some(Boolean) && a.parentId !== parentId) return false;
      if (kind !== "all" && a.kind !== "folder" && a.kind !== kind)
        return false;
      return (
        !query ||
        `${a.name} ${a.description} ${a.tags.join(" ")} ${a.style || ""} ${a.usage || ""}`
          .toLowerCase()
          .includes(query.toLowerCase())
      );
    })
    .sort(
      (a, b) =>
        Number(b.kind === "folder") - Number(a.kind === "folder") ||
        (sort === "name"
          ? a.name.localeCompare(b.name)
          : sort === "created"
            ? b.createdAt - a.createdAt
            : b.updatedAt - a.updatedAt),
    );
  const imageLayout = kind === 'image' || visible.some(asset => asset.kind === 'image');
  const folders = assets.filter((a) => a.kind === "folder" && !a.deletedAt);
  function newForm(
    mode: FormState["mode"],
    assetKind: PersonalAssetKind = "text",
    ids = selected,
  ) {
    setError("");
    setForm({
      mode,
      kind: assetKind,
      name: "",
      description: "",
      tags: "",
      content: initialContent(assetKind, t),
      parentId,
      ids,
      chooseKind: mode === "create" && kind === "all",
      entryMethod: fileKinds.has(assetKind) ? "upload" : "input",
      url: "",
    });
  }
  function open(asset: PersonalAsset) {
    if (asset.kind === "folder") {
      setParentId(asset.id);
      setView("all");
      setQuery("");
      return;
    }
    setError("");
    setTagDraft("");
    setPreview(asset);
  }
  async function edit(asset: PersonalAsset) {
    await act(async () => {
      let content = "";
      if (editable(asset)) {
        const r = await fetch(personalAssets.contentUrl(asset));
        if (!r.ok) throw new Error(t('entry.personalAssets.error.readContent'));
        content = await r.text();
      }
      setForm({
        mode: "edit",
        kind: asset.kind,
        name: asset.name,
        description: asset.description,
        tags: asset.tags.join(", "),
        content,
        parentId: asset.parentId,
        asset,
      });
    }, "");
  }
  async function useTemplateAsset(asset: PersonalAsset) {
    const template = personalAssetTemplate(asset);
    if (!template && onUseAsset) {
      await act(async () => {
        const versionName = asset.versions.at(-1)?.filename || asset.name;
        const extension = versionName.includes('.') ? versionName.slice(versionName.lastIndexOf('.')) : '';
        const name = extension && !asset.name.toLowerCase().endsWith(extension.toLowerCase()) ? `${asset.name}${extension}` : asset.name;
        await onUseAsset({name,url:new URL(personalAssets.contentUrl(asset),window.location.origin).href,prompt:asset.description,kind:asset.kind});
        setPreview(null);
      }, '');
      return;
    }
    if (!template || !onUseTemplate) return;
    await act(async () => {
      const response = await fetch(personalAssets.contentUrl(asset));
      if (!response.ok) throw new Error(t('entry.personalAssets.error.readTemplatePrompt'));
      onUseTemplate({...template,prompt:await response.text()});
    }, t('entry.personalAssets.notice.usedTemplate'));
  }
  async function submit() {
    if (!form) return;
    await act(async () => {
      if (form.mode === "move" || form.mode === "tag")
        await personalAssets.batch(
          form.ids!,
          form.mode,
          form.mode === "move"
            ? { parentId: form.parentId }
            : {
                tags: form.tags
                  .split(/[,，]/)
                  .map((part) => part.trim())
                  .filter(Boolean),
              },
        );
      else if (form.mode === "edit" && form.asset) {
        let current = form.asset;
        if (editable(current))
          current = (await personalAssets.version(current, form.content)).asset;
        // Keep the new revision for a retry if metadata validation fails after saving content.
        setForm((f) => (f ? { ...f, asset: current } : f));
        await personalAssets.patch(current.id, {
          name: form.name,
          description: form.description,
          tags: form.tags
            .split(/[,，]/)
            .map((part) => part.trim())
            .filter(Boolean),
          parentId: form.parentId,
          revision: current.revision,
        });
      } else if (
        form.mode === "create" &&
        (form.entryMethod === "upload" || fileKinds.has(form.kind))
      ) {
        const source =
          form.entryMethod === "input" ? { url: form.url!.trim() } : undefined;
        const file = source
          ? await readPersonalAssetUrl(source.url)
          : form.file;
        if (!file || !matchesFileKind(file, form.kind))
          throw new Error(t('entry.personalAssets.error.chooseKindFile', { kind: labels[form.kind] }));
        if (
          !fileKinds.has(form.kind) &&
          !(form.kind === "slides" && /\.(pptx?|odp)$/i.test(file.name))
        ) {
          // HTML imported as PPT/motion retains the active tab instead of becoming a webpage.
          const content = await readSourceFile(file, t);
          await personalAssets.create({
            spaceId: creationSpaceId(form.parentId),
            name: form.name,
            kind: form.kind,
            content,
            parentId: form.parentId,
          });
        } else {
          const extension = file.name.match(/\.[^.]+$/)?.[0] || "";
          const filename = form.name
            .toLowerCase()
            .endsWith(extension.toLowerCase())
            ? form.name
            : form.name + extension;
          const copy = new File([file], filename, { type: file.type });
          await personalAssets.upload(copy, form.parentId, source, creationSpaceId(form.parentId));
        }
      } else
        await personalAssets.create({
          spaceId: creationSpaceId(form.parentId),
          name: form.name,
          kind: form.kind,
          content: form.content,
          parentId: form.parentId,
        });
      if (form.mode === "create") {
        setView("all");
        setQuery("");
        setParentId(form.parentId);
      }
      setForm(null);
      setPreview(null);
      setSelected([]);
    }, t('entry.personalAssets.notice.savedToLibrary'));
  }
  function selectCreationFile(file?: File) {
    if (!form || form.mode !== "create" || form.kind === "folder" || busy)
      return false;
    if (
      file &&
      (!matchesFileKind(file, form.kind) || file.size > 200 * 1024 * 1024)
    ) {
      setError(
        file.size > 200 * 1024 * 1024
          ? t('entry.personalAssets.error.over200mb')
          : t('entry.personalAssets.error.chooseKindFile', { kind: labels[form.kind] }),
      );
      setForm({ ...form, file: undefined, entryMethod: "upload" });
      return false;
    }
    setError("");
    setForm({
      ...form,
      file,
      entryMethod: "upload",
      name:
        !form.name || form.name === form.file?.name
          ? file?.name || form.name
          : form.name,
    });
    return true;
  }
  async function upload(files: File[]) {
    if (!files.length) return;
    await act(async () => {
      let completed = 0;
      const importedFolders = new Map<string, string>();
      for (const file of files) {
        try {
          let target = parentId;
          const directories = (file.webkitRelativePath || "")
            .split("/")
            .slice(0, -1);
          let path = "";
          for (const part of directories) {
            path += `/${part}`;
            if (!importedFolders.has(path))
              importedFolders.set(
                path,
                (
                  await personalAssets.create({
                    name: part,
                    kind: "folder",
                    parentId: target,
                    spaceId: creationSpaceId(parentId),
                  })
                ).asset.id,
              );
            target = importedFolders.get(path)!;
          }
          await personalAssets.upload(file, target, undefined, creationSpaceId(parentId));
          completed++;
          setNotice(t('entry.personalAssets.notice.uploading', { done: completed, total: files.length }));
        } catch (e) {
          await refresh();
          throw new Error(
            t('entry.personalAssets.notice.uploadItemFailed', { done: completed, total: files.length, name: file.name, reason: e instanceof Error ? e.message : t('entry.personalAssets.notice.retry') }),
          );
        }
      }
    }, t('entry.personalAssets.notice.uploadedCount', { count: files.length }));
  }
  const download = (asset: PersonalAsset, version?: string) => {
    const a = document.createElement("a");
    a.href = personalAssets.contentUrl(asset, version, true);
    a.download = "";
    a.click();
  };
  return (
    <section
      className={styles.root}
      data-reference-selection={conversationSelection?.purpose === 'reference' ? 'true' : undefined}
      data-compact={compact}
      aria-label={t('entry.personalAssets.aria.manage')}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          e.stopPropagation();
          // Portal events still bubble through React: a drop into the creation dialog
          // stages its file; it must not also import directly into the catalogue.
          if (form) {
            selectCreationFile(e.dataTransfer.files[0]);
            return;
          }
          if (preview || confirmDelete) return;
          void upload(Array.from(e.dataTransfer.files));
        }
      }}
    >
      <ToolbarPortal container={toolbarContainer}>
<div className={styles.toolbar} role="group" aria-label={t('entry.personalAssets.aria.toolbar')}>
        {parentId ? (
          <nav className={styles.path} aria-label={t('entry.personalAssets.aria.path')}>
            <Button
              variant="ghost"
              aria-label={t('entry.personalAssets.aria.backMine')}
              title={t('entry.personalAssets.title.mine')}
              onClick={() => {
                setParentId(null);
                setView("all");
                setQuery("");
              }}
            >
              <Icon name="chevron-left" size={16} />
              <span className={styles.pathLabel}>{t('entry.personalAssets.backAll')}</span>
            </Button>
            {path.map((a) => (
              <span key={a.id}>
                <Icon name="chevron-right" size={12} />
                <Button
                  variant="ghost"
                  onClick={() => setParentId(a.id)}
                  title={a.name}
                >
                  {a.name}
                </Button>
              </span>
            ))}
          </nav>
        ) : (
          <span className={styles.toolbarSpacer} />
        )}
        {(kind === 'slides' || kind === 'all') && catalogueTools}
        <AssetEditButton editing={selectionMode} busy={busy} onClick={() => { setSelectionMode(value => !value); setSelected([]); }} />
        {selectionMode ? editModeTools : null}
        <AssetFilterPopover
          active={view !== 'all' || Boolean(tagFilter) || Object.values(assetFilters).some(Boolean) || sort !== 'updated' || (kindFilter === undefined && kind !== 'all')}
          count={activeFilterCount} sort={sort} onSortChange={setSort}
          onReset={() => { setView('all'); setParentId(null); setSort('updated'); setTagFilter(''); setAssetFilters(emptyAssetFilters); if (kindFilter === undefined) setKind('all'); }}
        >
            <label className={styles.filterRow}>
              {t('entry.personalAssets.filter.tags')}
              <Select aria-label={t('entry.personalAssets.aria.filterTags')} value={tagFilter} onChange={e => setTagFilter(e.target.value)}>
                <option value="">{t('entry.personalAssets.filter.allTags')}</option>
                {[...new Set([...availableTags, ...(tagFilter ? [tagFilter] : [])])].map(tag => <option key={tag} value={tag}>{tag}</option>)}
              </Select>
            </label>
            <div className={styles.filterRow} role="group" aria-label={t('entry.personalAssets.aria.view')}>
              <span>{t('entry.personalAssets.filter.scope')}</span>
              <div className={styles.filterChoices}>{([['all', t('entry.personalAssets.filter.all')],['recent', t('entry.personalAssets.filter.recent')],['favorite', t('entry.personalAssets.filter.favorite')]] as const).map(([id,label]) => <Button key={id} variant="ghost" size="xs" aria-pressed={view === id} onClick={() => {setView(id);setParentId(null);}}>{label}</Button>)}</div>
            </div>
            <AssetFilterFields value={assetFilters} onChange={setAssetFilters} assets={assets} />
            {kindFilter === undefined ? (
              <label className={styles.filterRow}>
                {t('entry.personalAssets.filter.assetType')}
                <Select
                  aria-label={t('entry.personalAssets.aria.filterType')}
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  <option value="all">{t('entry.personalAssets.filter.allTypes')}</option>
                  {Object.entries(labels)
                    .filter(([k]) => k !== "folder")
                    .map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                </Select>
              </label>
            ) : null}
        </AssetFilterPopover>
        <AssetSearchField
          className={styles.search}
          label={t('entry.personalAssets.search.label')}
          placeholder={t('entry.personalAssets.search.placeholder')}
          clearLabel={t('entry.personalAssets.search.clear')}
          value={query}
          onChange={setQuery}
        />
        {selectionMode ? (
          <AssetDeleteSelection count={selected.length} busy={busy} onClick={() => setConfirmDelete(selected)} />
        ) : (
          <>
            <Button
              variant="primary"
              aria-label={t('entry.personalAssets.new.aria')}
              className={`${styles.action} bezier-tooltip`}
              data-tooltip={
                kind in labels
                  ? t('entry.personalAssets.new.kind', { kind: labels[kind as PersonalAssetKind] })
                  : t('entry.personalAssets.new.asset')
              }
              disabled={busy}
              onClick={() =>
                newForm(
                  "create",
                  kind in labels ? (kind as PersonalAssetKind) : "text",
                )
              }
            >
              <Icon name="plus" size={15} />
              <span>{t('entry.personalAssets.new')}</span>
            </Button>
          </>
        )}
        <input
          hidden
          ref={uploadRef}
          type="file"
          multiple
          onChange={(e) => {
            void upload(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
      </div>
      </ToolbarPortal>
      {error ? (
        <div className={styles.error} role="alert">
          {error}
          <Button variant="ghost" size="sm" onClick={() => void refresh()}>
            {t('entry.personalAssets.reload')}
          </Button>
        </div>
      ) : null}
      {notice && typeof document !== "undefined" ? createPortal(
        <Toast message={notice} placement="top" tone={busy ? "loading" : "success"}
          ttlMs={busy ? 0 : 3000} onDismiss={() => setNotice("")} />,
        document.body,
      ) : null}
      {loading ? (
        <WorkspaceEmptyState><p>{t('entry.personalAssets.loading')}</p></WorkspaceEmptyState>
      ) : error && !assets.length ? null : visible.length === 0 && hideEmpty ? null : visible.length === 0 ? (
        <WorkspaceEmptyState>
          <Icon name={"folder"} size={30} />
          <strong>
            {query || activeFilterCount > 0
              ? t('entry.personalAssets.empty.filtered')
              : t('entry.personalAssets.empty.start')}
          </strong>
          <p>
            {query || activeFilterCount > 0
              ? t('entry.personalAssets.empty.filteredHint')
              : t('entry.personalAssets.empty.startHint')}
          </p>
          {query || activeFilterCount > 0 ? (
            <Button
              onClick={() => {
                setQuery("");
                setView("all"); setTagFilter(""); setAssetFilters(emptyAssetFilters);
                if (kindFilter === undefined) setKind("all");
              }}
            >
              {t('entry.personalAssets.clearFilters')}
            </Button>
          ) : (
            <Button onClick={() => uploadRef.current?.click()}>{t('entry.personalAssets.upload')}</Button>
          )}
        </WorkspaceEmptyState>
      ) : (
        <>
          <NaturalMasonry
            enabled={imageLayout}
            density={compact ? 'compact' : 'library'}
            itemKeys={visible.map(asset => asset.id)}
            className={`community-template-grid ${styles.items}${imageLayout ? ` community-template-grid--image ${styles.imageItems}` : ''}`}
          >
            {visible.map((asset) => (
              <div key={asset.id} className="community-template-card-reveal">
                <CollectionCard
                  variant="media"
                  interactive
                  className={`community-template-card is-clickable ${styles.card}${asset.kind === "image" ? " community-template-card--image" : ""}`}
                  data-selected={selected.includes(asset.id)}
                  data-editing={selectionMode}
                  draggable={Boolean(
                    projectId &&
                    asset.kind !== "folder" &&
                    !asset.deletedAt &&
                    !viewerOnly && !conversationSelection,
                  )}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "copy";
                    e.dataTransfer.setData(
                      PERSONAL_ASSET_DRAG_MIME,
                      JSON.stringify({ id: asset.id, projectId }),
                    );
                  }}
                >
                  <PersonalAssetCardPreview
                    asset={asset}
                    label={labels[asset.kind]}
                    foreground
                  >
                    <Button
                      variant="ghost"
                      className={styles.open}
                      disabled={Boolean(asset.deletedAt)}
                      onClick={() => selectionMode ? setSelected(ids => ids.includes(asset.id) ? ids.filter(id => id !== asset.id) : [...ids,asset.id]) : open(asset)}
                      aria-label={selectionMode ? t('entry.personalAssets.aria.toggleSelect', { name: asset.name }) : t('entry.personalAssets.aria.open', { name: asset.name })}
                    />
                    <CollectionCardMediaMeta
                      className={styles.cardMeta}
                      style={{ pointerEvents: "none" }}
                    >
                      <strong title={asset.name}>{asset.name}</strong>
                      <span>
                        {labels[asset.kind]}
                        {asset.favorite ? t('entry.personalAssets.favorited') : ''} ·{" "}
                        {formatAppDate(asset.updatedAt, locale)}
                        {allContent ? ` · ${spaceOptions?.find(space => space.id === assetSpaceId(asset))?.name ?? assetSpaceId(asset)}` : ''}
                      </span>
                    </CollectionCardMediaMeta>
                    {selectionMode && !asset.deletedAt ? (
                      <Checkbox
                        className={styles.cardSelection}
                        aria-label={t('entry.personalAssets.aria.select', { name: asset.name })}
                        checked={selected.includes(asset.id)}
                        onCheckedChange={(checked) =>
                          setSelected((s) =>
                            checked
                              ? [...s, asset.id]
                              : s.filter((id) => id !== asset.id),
                          )
                        }
                      />
                    ) : null}
                    {!conversationSelection ? <div className={styles.cardTools}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('entry.personalAssets.aria.more', { name: asset.name })}
                            title={t('entry.personalAssets.more')}
                          >
                            <Icon name="more-horizontal" size={16} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {(                            <>
                              <DropdownMenuItem
                                onSelect={() => void edit(asset)}
                              >
                                {editable(asset) ? t('entry.personalAssets.editInfoContent') : t('entry.personalAssets.editInfo')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  void act(
                                    () =>
                                      personalAssets.patch(asset.id, {
                                        favorite: !asset.favorite,
                                        revision: asset.revision,
                                      }),
                                    asset.favorite ? t('entry.personalAssets.notice.unfavorited') : t('entry.personalAssets.notice.favorited'),
                                  )
                                }
                              >
                                {asset.favorite ? t('entry.personalAssets.unfavorite') : t('entry.personalAssets.favorite')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  newForm("move", "folder", [asset.id])
                                }
                              >
                                {t('entry.personalAssets.moveTo')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  void act(
                                    () =>
                                      personalAssets.batch([asset.id], "copy", {
                                        parentId: asset.parentId,
                                      }),
                                    t('entry.personalAssets.notice.copied'),
                                  )
                                }
                              >
                                {t('entry.personalAssets.duplicate')}
                              </DropdownMenuItem>
                              {asset.kind !== "folder" && !personalAssetTemplate(asset) ? (
                                <DropdownMenuItem
                                  onSelect={() => download(asset)}
                                >
                                  {t('entry.personalAssets.downloadSource')}
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuItem
                                onSelect={() => setConfirmDelete([asset.id])}
                              >
                                {t('entry.personalAssets.delete')}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div> : null}
                    {!compact && ((personalAssetTemplate(asset) && onUseTemplate) || (!personalAssetTemplate(asset) && onUseAsset)) && !selectionMode ? (
                      <CollectionCardMediaActions align="center" className="community-template-card__actions"><Button variant="default" className="community-template-card__action" disabled={busy} onClick={() => void useTemplateAsset(asset)}>{t('entry.personalAssets.useTemplate')}</Button></CollectionCardMediaActions>
                    ) : null}
                    {projectId &&
                    asset.kind !== "folder" &&
                    !asset.deletedAt ? (
                      <CollectionCardMediaActions
                        align={compact || asset.kind === "image" ? "center" : "end"}
                        className={compact ? styles.compactCanvasActions : undefined}
                      >
                        <Button
                          size={compact ? "xs" : "sm"}
                          variant={compact ? "default" : "subtle"}
                          className={compact ? styles.compactCanvasAction : "community-template-card__action"}
                          disabled={
                            busy || viewerOnly || workspaceContextLoading
                          }
                          onClick={() => conversationSelection ? void act(async () => {
                            if (conversationSelection.controller.signal.aborted) return;
                            const accepted = await conversationSelection.onSelect(asset);
                            if (!accepted && !conversationSelection.controller.signal.aborted) throw new Error(t('entry.personalAssets.error.templateUnusable'));
                          }, '') : useAsset(asset)}
                        >
                          {conversationSelection ? t(conversationSelection.purpose === 'reference' ? 'canvas.text.useReference' : 'entry.personalAssets.useAndContinue') : t('entry.personalAssets.addToBoard')}
                        </Button>
                      </CollectionCardMediaActions>
                    ) : null}
                  </PersonalAssetCardPreview>
                </CollectionCard>
              </div>
            ))}
          </NaturalMasonry>
        </>
      )}
      {form
        ? createPortal(
            <Dialog
              ariaLabel={
                form.mode === "edit"
                  ? t('entry.personalAssets.dialog.edit')
                  : form.mode === "move"
                    ? t('entry.personalAssets.dialog.move')
                    : form.mode === "tag"
                      ? t('entry.personalAssets.dialog.batchTags')
                      : t('entry.personalAssets.dialog.create')
              }
              className={styles.dialog}
              onClose={() => {
                if (!busy) setForm(null);
              }}
              closeOnEscape
            >
              <DialogTitle>
                {form.mode === "edit"
                  ? t('entry.personalAssets.dialog.editAsset')
                  : form.mode === "move"
                    ? t('entry.personalAssets.dialog.moveFolder')
                    : form.mode === "tag"
                      ? t('entry.personalAssets.dialog.batchSetTags')
                      : t('entry.personalAssets.dialog.newKind', { kind: labels[form.kind] })}
              </DialogTitle>
              <DialogBody className={styles.form}>
                {form.chooseKind ? (
                  <label>
                    {t('entry.personalAssets.form.assetType')}
                    <Select
                      aria-label={t('entry.personalAssets.aria.newKind')}
                      value={form.kind}
                      onChange={(e) => {
                        const nextKind = e.target.value as PersonalAssetKind;
                        setError("");
                        setForm({
                          ...form,
                          kind: nextKind,
                          content: initialContent(nextKind, t),
                          file: undefined,
                          url: "",
                          entryMethod: fileKinds.has(nextKind)
                            ? "upload"
                            : "input",
                        });
                      }}
                    >
                      {Object.entries(labels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </label>
                ) : null}
                {form.mode === "create" && form.kind !== "folder" ? (
                  <SegmentedControl
                    aria-label={t('entry.personalAssets.aria.entryMethod')}
                    value={form.entryMethod || "input"}
                    onValueChange={(value) => {
                      setError("");
                      setForm({
                        ...form,
                        entryMethod: value as "input" | "upload",
                      });
                    }}
                    disabled={busy}
                  >
                    <SegmentedControlItem value="input">
                      <Icon name="edit" size={14} />
                      {t('entry.personalAssets.form.freeInput')}
                    </SegmentedControlItem>
                    <SegmentedControlItem value="upload">
                      <Icon name="upload" size={14} />
                      {t('entry.personalAssets.form.uploadFile')}
                    </SegmentedControlItem>
                  </SegmentedControl>
                ) : null}
                {form.mode === "create" &&
                form.entryMethod === "upload" &&
                form.kind !== "folder" ? (
                  <label>
                    {t('entry.personalAssets.form.chooseKindFile', { kind: labels[form.kind] })}
                    <Input
                      key={form.kind}
                      type="file"
                      accept={acceptedFiles[form.kind]}
                      aria-label={t('entry.personalAssets.aria.chooseKindFile', { kind: labels[form.kind] })}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!selectCreationFile(file)) e.target.value = "";
                      }}
                    />
                    <span className={styles.inputHint}>
                      {form.file
                        ? t('entry.personalAssets.form.selectedFile', { name: form.file.name })
                        : acceptedFiles[form.kind]?.replaceAll(",", " · ") ||
                          t('entry.personalAssets.form.chooseOtherType')}
                    </span>
                  </label>
                ) : null}
                {form.mode === "create" &&
                form.entryMethod === "input" &&
                fileKinds.has(form.kind) ? (
                  <label>
                    {t('entry.personalAssets.form.resourceUrl')}
                    <Input
                      type="url"
                      aria-label={t('entry.personalAssets.aria.resourceUrl')}
                      placeholder="https://…"
                      value={form.url || ""}
                      onChange={(e) =>
                        setForm({ ...form, url: e.target.value })
                      }
                    />
                    <span className={styles.inputHint}>
                      {t('entry.personalAssets.form.pasteKind', { kind: labels[form.kind] })}
                      {t('entry.personalAssets.form.urlHint')}
                    </span>
                  </label>
                ) : null}
                {!["move", "tag"].includes(form.mode) ? (
                  <label>
                    {t('entry.personalAssets.form.name')}
                    <Input
                      autoFocus
                      value={form.name}
                      maxLength={200}
                      onChange={(e) =>
                        setForm({ ...form, name: e.target.value })
                      }
                      placeholder={t('entry.personalAssets.form.namePlaceholder')}
                    />
                  </label>
                ) : null}
                {form.mode !== "tag" ? (
                  <label>
                    {t('entry.personalAssets.form.saveLocation')}
                    <Select
                      aria-label={t('entry.personalAssets.aria.saveLocation')}
                      value={form.parentId || ""}
                      onChange={(e) =>
                        setForm({ ...form, parentId: e.target.value || null })
                      }
                    >
                      <option value="">{t('entry.personalAssets.form.myAssets')}</option>
                      {folders
                        .filter((a) => a.id !== form.asset?.id)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </Select>
                  </label>
                ) : null}
                {form.mode === "edit" ? (
                  <label>
                    {t('entry.personalAssets.form.description')}
                    <Textarea
                      value={form.description}
                      maxLength={4000}
                      onChange={(e) =>
                        setForm({ ...form, description: e.target.value })
                      }
                    />
                  </label>
                ) : null}
                {["edit", "tag"].includes(form.mode) ? (
                  <label>
                    {t('entry.personalAssets.form.tags')}
                    <Input
                      value={form.tags}
                      placeholder={t('entry.personalAssets.form.tagsPlaceholder')}
                      onChange={(e) =>
                        setForm({ ...form, tags: e.target.value })
                      }
                    />
                  </label>
                ) : null}
                {(form.mode === "create" &&
                  form.entryMethod !== "upload" &&
                  form.kind !== "folder" &&
                  !fileKinds.has(form.kind)) ||
                (form.asset && editable(form.asset)) ? (
                  <label>
                    {["slides", "webpage", "motion"].includes(form.kind)
                        ? t('entry.personalAssets.form.htmlSource')
                        : t('entry.personalAssets.form.content')}
                    <Textarea
                      className={styles.editor}
                      value={form.content}
                      onChange={(e) =>
                        setForm({ ...form, content: e.target.value })
                      }
                    />
                  </label>
                ) : null}
                {form.mode === "edit" &&
                form.asset &&
                !editable(form.asset) &&
                form.kind !== "folder" ? (
                  <p>{t('entry.personalAssets.form.replaceHint')}</p>
                ) : null}
                {error ? (
                  <p role="alert" className={styles.error}>
                    {error}
                  </p>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <Button disabled={busy} onClick={() => setForm(null)}>
                  {t('entry.personalAssets.cancel')}
                </Button>
                <Button
                  variant="primary"
                  disabled={
                    busy ||
                    (form.mode === "create" &&
                      form.entryMethod === "upload" &&
                      form.kind !== "folder" &&
                      !form.file) ||
                    (form.mode === "create" &&
                      form.entryMethod === "input" &&
                      fileKinds.has(form.kind) &&
                      !form.url?.trim()) ||
                    (!["move", "tag"].includes(form.mode) &&
                      !form.name.trim())
                  }
                  onClick={() => void submit()}
                >
                  {busy ? t('entry.personalAssets.saving') : t('entry.personalAssets.save')}
                </Button>
              </DialogFooter>
            </Dialog>,
            document.body,
          )
        : null}
      {confirmDelete
        ? createPortal(
            <ConfirmDialog
              title={t('entry.personalAssets.deleteTitle')}
              description={t('entry.personalAssets.deleteBody', { count: confirmDelete.length })}
              confirmLabel={t('entry.personalAssets.delete')}
              cancelLabel={t('entry.personalAssets.cancel')}
              onCancel={() => {
                if (!busy) setConfirmDelete(null);
              }}
              onConfirm={() =>
                void act(async () => {
                  await personalAssets.batch(confirmDelete, "delete");
                  setConfirmDelete(null);
                  setSelected([]);
                }, t('entry.personalAssets.notice.deleted'))
              }
            />,
            document.body,
          )
        : null}
      {preview && conversationSelection ? <AssetPreviewDialog source={personalAssetPreviewSource(preview)} onClose={() => setPreview(null)} /> : null}
      {preview && !conversationSelection
        ? createPortal(
            <AssetDetailDialog title={preview.name} meta={labels[preview.kind]} onClose={() => setPreview(null)}>
              <AssetDetailBody className={styles.detailBody}>
                <div className={styles.stage}>
                  <AssetContentPreview source={personalAssetPreviewSource(preview)} />
                </div>
                <AssetAnalysisFields key={preview.id} asset={preview} onUpdate={setPreview} space={spaceOptions && <AssetSpaceField spaces={spaceOptions} value={preview.spaceId || (preview.source.projectId && projectSpaceIds?.[preview.source.projectId]) || 'default-project'} disabled={busy} onChange={nextSpaceId => {
                      const current = preview;
                      void act(async () => { const result=await personalAssets.patch(current.id, { spaceId: nextSpaceId, parentId: null, revision: current.revision }); setPreview(result.asset); }, t('entry.personalAssets.notice.movedSpace'));
                    }}/> }>
                  <AssetDetailSection title={<> <label htmlFor="asset-detail-name">{t('entry.personalAssets.detail.name')}</label> </>}>
                    <Input id="asset-detail-name" key={preview.id} className={styles.inlineField} defaultValue={preview.name} disabled={busy} maxLength={240} onBlur={e => saveDetail("name", e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur(); }} />
                  </AssetDetailSection>
                  <AssetDetailSection title={<> {t('entry.personalAssets.detail.tags')} </>}>
                    <div className={styles.tagList}>
                      {preview.tags.map(tag => <span className={styles.tag} key={tag}>
                        <span>{tag}</span>
                        <Button variant="ghost" size="xs" aria-label={t('entry.personalAssets.aria.removeTag', { tag })} disabled={busy} onClick={() => saveTags(preview.tags.filter(item => item !== tag))}><Icon name="close" size={12} /></Button>
                      </span>)}
                      <AssetTagPicker tags={preview.tags} availableTags={availableTags} busy={busy} draft={tagDraft} onDraft={setTagDraft} onAdd={addTag} onToggle={tag => preview.tags.includes(tag) ? saveTags(preview.tags.filter(item => item !== tag)) : addTag(tag)} />
                    </div>
                  </AssetDetailSection>
                  <AssetDetailSection title={<> <label htmlFor="asset-detail-description">{t('entry.personalAssets.detail.description')}</label> </>}>
                    <Textarea id="asset-detail-description" key={preview.id} className={styles.inlineField} defaultValue={preview.description} disabled={busy} rows={4} placeholder={t('entry.personalAssets.form.descriptionPlaceholder')} onBlur={e => saveDetail("description", e.target.value)} />
                  </AssetDetailSection>
                  <AssetDetailSection title={t('entry.personalAssets.detail.style')}><Textarea aria-label={t('entry.personalAssets.aria.style')} key={`${preview.id}-style-${preview.style}`} defaultValue={preview.style || ''} disabled={busy} rows={2} onBlur={e=>saveDetail('style',e.target.value)}/></AssetDetailSection>
                  <AssetDetailSection title={t('entry.personalAssets.detail.usage')}><Textarea aria-label={t('entry.personalAssets.aria.usage')} key={`${preview.id}-usage-${preview.usage}`} defaultValue={preview.usage || ''} disabled={busy} rows={2} onBlur={e=>saveDetail('usage',e.target.value)}/></AssetDetailSection>
                  <AssetRatingField value={preview.rating} disabled={busy} onChange={rating => {
                    const current = preview;
                    void act(async () => { const result = await personalAssets.patch(current.id, {rating, revision: current.revision}); setPreview(value => value?.id === current.id ? result.asset : value); }, t('entry.personalAssets.notice.ratingSaved'));
                  }}/>
                  <AssetDetailSection title={<> {t('entry.personalAssets.detail.fileInfo')} </>}>
                    <dl className={styles.fileInfo}>
                      {preview.versions.at(-1)?.imageMetadata?.width && <><dt>{t('entry.personalAssets.meta.dimensions')}</dt><dd>{preview.versions.at(-1)?.imageMetadata?.width} × {preview.versions.at(-1)?.imageMetadata?.height}</dd></>}
                      <dt>{t('entry.personalAssets.meta.type')}</dt><dd>{labels[preview.kind]}</dd>
                      <dt>{t('entry.personalAssets.meta.size')}</dt><dd>{((preview.versions.at(-1)?.size || 0) / 1024 / 1024).toFixed(2)} MB</dd>
                      <dt>{t('entry.personalAssets.meta.added')}</dt><dd>{formatAppDate(preview.createdAt, locale)}</dd>
                    </dl>
                    <div className={styles.tagList} style={{marginTop:12}}>{preview.versions.at(-1)?.imageMetadata?.colors.map(color=><Button size="icon" key={color.hex} aria-label={t('entry.personalAssets.aria.similarColor', { hex: color.hex })} title={color.hex} style={{background:color.hex,width:22,height:22,minWidth:22,border:'1px solid var(--border)'}} onClick={()=>{setAssetFilters({...emptyAssetFilters,color:color.hex});setTagFilter('');setQuery('');setPreview(null);}} />)}</div>
                    {preview.source.url && <a href={preview.source.url} target="_blank" rel="noreferrer" className={styles.sourceLink}>{t('entry.personalAssets.viewSource')} <Icon name="external-link" size={14} /></a>}
                  </AssetDetailSection>
                {error ? (
                  <p role="alert" className={styles.error}>
                    {error}
                  </p>
                ) : null}
                </AssetAnalysisFields>
              </AssetDetailBody>
              <DialogFooter className={styles.previewFooter}>
                <div className={styles.previewMeta}>
                  <span
                    className="bezier-tooltip"
                    data-tooltip={preview.name}
                  >
                    {preview.name}
                  </span>
                  {preview.source.url ? (
                    <a
                      href={preview.source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('entry.personalAssets.viewOrigin')}
                    </a>
                  ) : null}
                </div>
                <div className={styles.previewActions}>
                  {!personalAssetTemplate(preview) && <Button variant="ghost" onClick={() => download(preview)}>
                    <Icon name="download" size={15} />
                    {t('entry.personalAssets.download')}
                  </Button>}
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => replaceRef.current?.click()}
                  >
                    <Icon name="upload" size={15} />
                    {t('entry.personalAssets.replace')}
                  </Button>
                  {((personalAssetTemplate(preview) && onUseTemplate) || (!personalAssetTemplate(preview) && onUseAsset)) ? <Button variant="primary" disabled={busy} onClick={() => void useTemplateAsset(preview)}>{t('entry.personalAssets.use')}</Button> : null}
                </div>
              </DialogFooter>
              <input
                type="file"
                ref={replaceRef}
                hidden
                aria-label={t('entry.personalAssets.aria.uploadNewKind', { kind: labels[preview.kind] })}
                accept={acceptedFiles[preview.kind]}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file)
                    void act(async () => {
                      setPreview(
                        (await personalAssets.version(preview, file)).asset,
                      );
                    }, t('entry.personalAssets.notice.contentUpdated'));
                }}
              />
            </AssetDetailDialog>,
            document.body,
          )
        : null}
    </section>
  );
}

function ToolbarPortal({ container, children }: { container?: HTMLElement | null; children: ReactNode }) {
  return container ? createPortal(children, container) : children;
}
