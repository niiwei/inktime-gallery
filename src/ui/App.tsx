import { ArrowLeft, CheckSquare, ChevronLeft, ChevronRight, Download, FolderOpen, Home, Images, ListTodo, Pause, Play, RefreshCw, RotateCcw, Settings2, Shuffle, Sparkles, Square, StopCircle, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, FormEvent, PointerEvent as ReactPointerEvent } from "react";
import type { GalleryImage } from "../data/types";

type SortMode = "memory" | "newest" | "capture";
type GalleryCollection = "sources" | "representative" | "all" | "curated";
type SourceStatus = "all" | "pending" | "processed" | "skipped" | "failed" | "processing";
type ViewMode = { type: "gallery" } | { type: "detail"; id: string };
type ProcessMode = "new" | "rerun";
type Section = "review" | "manage" | "tasks" | "wallpaper";
type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number };
type SelectionFilters = { collection?: GalleryCollection; status?: SourceStatus; month?: number | "all"; day?: number | "all"; dateTo?: string; dateFrom?: string; location?: string; minScore?: number | ""; maxScore?: number | ""; sort?: SortMode };
type TaskStatus = "queued" | "running" | "paused" | "done" | "cancelled" | "error";
type Task = {
  id: string;
  mode: string;
  status: TaskStatus;
  total: number;
  done: number;
  succeeded: number;
  failed: number;
  scanErrors?: number;
  currentFile: string;
  stage: string;
  message: string;
  tokenTotal: number;
  createdAt: string;
};
type WallpaperStatus = { current: { fileName?: string; wallpaperPath?: string; url?: string; } | null; history: Array<{ url?: string; fileName?: string; setAt?: string; at?: string }>; nextUpdateAt: string | null; lastError: string | null; screen?: { width: number; height: number } };
type ProcessProgress = {
  stage?: string;
  id: string;
  mode: "idle" | "new" | "selected" | "rerun" | "rerender";
  status: "idle" | "running" | "paused" | "cancelled" | "done" | "error";
  message: string;
  currentFile: string;
  total: number;
  done: number;
  succeeded: number;
  failed: number;
  skipped: number;
  skippedDuplicates: number;
  tokenTotal: number;
  aguiEvents?: Array<{
    id: string;
    kind: "read" | "compress" | "call" | "output" | "warn" | "error";
    text: string;
    at: string;
  }>;
};

type LibraryStats = {
  original: number;
  processed: number;
  pending: number;
  skipped: number;
  failed: number;
  curated: number;
  representatives: number;
  similarGroups: number;
  tokenTotal: number;
  databasePath: string;
};

type SourcePhoto = {
  id: string;
  processedId: string;
  fileName: string;
  sourcePath: string;
  sourceUrl: string;
  thumbnailUrl?: string;
  status: SourceStatus;
  skipCode: string;
  skipReason: string;
  capturedAt: string;
  capturedDate: string;
  location: string;
  width: number;
  height: number;
  orientation: string;
  processedAt: string;
  memoryScore: number | null;
  caption: string;
  similarGroupId: string;
  isRepresentative: boolean;
  isCurated: boolean;
  wallpaperExcluded?: boolean;
  manualEdits?: GalleryImage["manualEdits"];
};

type ApiConfig = {
  imageDir: string;
  providerBaseUrl: string;
  apiKeyEnvName: string;
  apiKeyConfigured: boolean;
  model: string;
  modelOptions: string[];
  excludeScreenshots: boolean;
  excludeNamePatterns: string[];
  maxImagesPerRun: number;
  maxConcurrentImages: number;
  dataDir: string;
  databaseFile: string;
  renderFrameMode: "fixed" | "adaptive";
  renderWidth: number;
  renderHeight: number;
  footerHeight: number;
  wallpaperWidth: number;
  wallpaperHeight: number;
  wallpaperAutoIntervalHours: number;
  wallpaperCollection: "curated" | "representative" | "all";
  layoutTemplates: LayoutTemplates;
  promptVersion: string;
  scoringPrompt: string;
  sideCaptionPrompt: string;
};

type ConfigDraft = Omit<ApiConfig, "apiKeyConfigured" | "modelOptions" | "excludeNamePatterns"> & {
  modelOptionsText: string;
  excludeNamePatternsText: string;
};

type FrameKind = "portrait" | "landscape" | "square";
type LayoutElementKey = "photo" | "caption" | "date" | "place" | "score";
type LayoutElement = {
  x: number;
  y: number;
  width: number;
  height: number;
  visible?: boolean;
  fit?: "cover" | "contain";
  radius?: number;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  align?: "left" | "center" | "right";
};
type LayoutTemplate = {
  width: number;
  height: number;
  background: string;
  elements: Record<LayoutElementKey, LayoutElement>;
};
type LayoutTemplates = Record<FrameKind, LayoutTemplate>;

const monthOptions = Array.from({ length: 12 }, (_, index) => index + 1);
const dayOptions = Array.from({ length: 31 }, (_, index) => index + 1);
const layoutLayers: LayoutElementKey[] = ["photo", "caption", "date", "place", "score"];
const fontOptions = [
  { label: "Noto 中文衬线", value: "Noto Serif CJK SC, serif" },
  { label: "苹方 / 黑体", value: "PingFang SC, Hiragino Sans GB, sans-serif" },
  { label: "楷体", value: "Kaiti SC, STKaiti, serif" },
  { label: "Helvetica", value: "Helvetica Neue, Arial, sans-serif" },
];

export function App() {
  const [items, setItems] = useState<PageResult<GalleryImage>>({ items: [], total: 0, page: 1, pageSize: 60 });
  const [sources, setSources] = useState<PageResult<SourcePhoto>>({ items: [], total: 0, page: 1, pageSize: 60 });
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [draftConfig, setDraftConfig] = useState<ConfigDraft | null>(null);
  const [section, setSection] = useState<Section>("review");
  const [collection, setCollection] = useState<GalleryCollection>("curated");
  const [sourceStatus, setSourceStatus] = useState<SourceStatus>("all");
  const [sortMode, setSortMode] = useState<SortMode>("memory");
  const [month, setMonth] = useState<number | "all">("all");
  const [day, setDay] = useState<number | "all">("all");
  const [dateTo, setDateTo] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [wallpaperItems, setWallpaperItems] = useState<GalleryImage[]>([]);
  const [location, setLocation] = useState("");
  const [minScore, setMinScore] = useState<number | "">("");
  const [maxScore, setMaxScore] = useState<number | "">("");
  const [page, setPage] = useState(1);
  const pageSize = 60;
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [selectAllResults, setSelectAllResults] = useState(false);
  const [selectionFilters, setSelectionFilters] = useState<SelectionFilters>({});
  const [view, setView] = useState<ViewMode>({ type: "gallery" });
  const [detailPhoto, setDetailPhoto] = useState<GalleryImage | null>(null);
  const [sourcePreview, setSourcePreview] = useState<SourcePhoto | null>(null);
  const selectionAnchor = useRef<string | null>(null);
  const photoRequest = useRef(0);
  const sourceRequest = useRef(0);
  const initialNavigation = useRef(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [resumePrompt, setResumePrompt] = useState<Task | null>(null);
  const checkedRecovery = useRef(false);
  const [progress, setProgress] = useState<ProcessProgress | null>(null);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [wallpaper, setWallpaper] = useState<WallpaperStatus | null>(null);
  const [message, setMessage] = useState("");
  const [isSettingWallpaper, setIsSettingWallpaper] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [layoutEditorOpen, setLayoutEditorOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);

  const activeItems = collection === "sources" ? sources.items : items.items;
  const total = collection === "sources" ? sources.total : items.total;
  const selected = view.type === "detail" ? items.items.find((item) => item.id === view.id) ?? (detailPhoto?.id === view.id ? detailPhoto : null) : null;
  const visibleSourceIds = sources.items.map((source) => source.id);
  const allVisibleSourcesSelected = visibleSourceIds.length > 0 && visibleSourceIds.every((id) => selectedSourceIds.includes(id));
  const runningTask = tasks.find((task) => task.status === "running" || task.status === "queued" || task.status === "paused") ?? null;
  const databasePath = stats?.databasePath ?? (config ? config.dataDir + "/" + config.databaseFile : "--");

  const queryFilters = useMemo<SelectionFilters>(() => ({
    collection: collection,
    status: sourceStatus,
    month,
    day,
    dateTo: dateTo || undefined,
    dateFrom: dateFrom || undefined,
    location: location || undefined,
    minScore,
    maxScore,
    sort: sortMode,
  }), [collection, day, dateTo, dateFrom, location, maxScore, minScore, month, sortMode, sourceStatus]);

  useEffect(() => {
    if (!settingsOpen && !sourcePreview) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex="0"]') || []).filter(element => !element.hasAttribute("disabled"));
    focusable()[0]?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setSettingsOpen(false); setSourcePreview(null); }
      if (event.key !== "Tab") return;
      const elements=focusable();
      const target=event.shiftKey ? elements.at(-1) : elements[0];
      if (document.activeElement === (event.shiftKey ? elements[0] : elements.at(-1))) { event.preventDefault(); target?.focus(); }
    };
    document.addEventListener("keydown",handler);
    return () => { document.removeEventListener("keydown",handler); previous?.focus(); };
  }, [settingsOpen,sourcePreview]);

  useEffect(() => {
    void Promise.all([fetchConfig(), fetchStats(), fetchTasks(), refreshWallpaper(), refreshGallery(1), refreshSources(1), fetchProgress()]);
  }, []);

  useEffect(() => {
    setPage(1);
    setSelectAllResults(false);
    setSelectionFilters({});
    if (collection === "sources" || section === "manage") void refreshSources(1);
    else void refreshGallery(1);
  }, [collection, sourceStatus, sortMode, month, day, dateTo, dateFrom, location, minScore, maxScore]);

  useEffect(() => {
    if (section === "tasks") void fetchTasks();
    if (section === "wallpaper") void refreshWallpaper();
  }, [section]);

  useEffect(() => {
    if (!runningTask || runningTask.status === "paused") return;
    const timer = window.setInterval(() => {
      void fetchTasks();
      void fetchProgress();
      void fetchStats();
      if (section !== "wallpaper") void refreshGallery(page);
      if (section === "manage") void refreshSources(page);
    }, 900);
    return () => window.clearInterval(timer);
  }, [page, runningTask?.id, runningTask?.status, section]);

  useEffect(() => {
    if (!selected || settingsOpen || layoutEditorOpen) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const index = items.items.findIndex((entry) => entry.id === selected.id);
      if (event.key === "ArrowLeft" && index > 0) setView({ type: "detail", id: items.items[index - 1].id });
      if (event.key === "ArrowRight" && index >= 0 && index < items.items.length - 1) setView({ type: "detail", id: items.items[index + 1].id });
      if (event.key.toLowerCase() === "f") void toggleCurated(selected);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [items.items, layoutEditorOpen, selected, settingsOpen]);

  async function fetchConfig() {
    const response = await fetch("/api/config");
    if (!response.ok) return;
    const next = (await response.json()) as ApiConfig;
    setConfig(next);
    setDraftConfig(toDraft(next));
  }

  function buildQuery(targetPage: number, kind: "photos" | "sources") {
    const params = new URLSearchParams();
    params.set("page", String(targetPage));
    params.set("pageSize", String(pageSize));
    if (kind === "photos") params.set("collection", collection === "sources" ? "all" : collection);
    if (kind === "sources" && sourceStatus !== "all") params.set("status", sourceStatus);
    if (month !== "all") params.set("month", String(month));
    if (day !== "all") params.set("day", String(day));
    if (dateTo) params.set("dateTo", dateTo);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (location) params.set("location", location);
    if (minScore !== "") params.set("minScore", String(minScore));
    if (maxScore !== "") params.set("maxScore", String(maxScore));
    params.set("sort", sortMode);
    return params.toString();
  }

  async function refreshGallery(targetPage = page) {
    const sequence = ++photoRequest.current;
    const response = await fetch("/api/photos?" + buildQuery(targetPage, "photos"));
    if (!response.ok) return;
    const data = await response.json() as PageResult<GalleryImage> | GalleryImage[];
    const result = normalizePage(data, targetPage, pageSize);
    if (sequence !== photoRequest.current) return;
    setItems(result);
    setPage(result.page);
  }

  async function refreshSources(targetPage = page) {
    const sequence = ++sourceRequest.current;
    const response = await fetch("/api/sources?" + buildQuery(targetPage, "sources"));
    if (!response.ok) return;
    const data = await response.json() as PageResult<SourcePhoto> | SourcePhoto[];
    const result = normalizePage(data, targetPage, pageSize);
    if (sequence !== sourceRequest.current) return;
    setSources(result);
    setPage(result.page);

  }

  async function fetchStats() {
    const response = await fetch("/api/library/stats");
    if (!response.ok) return;
    const nextStats = (await response.json()) as LibraryStats;
    setStats(nextStats);
    if (!initialNavigation.current) { initialNavigation.current=true; if (!nextStats.processed) { setSection("manage"); setCollection("sources"); } }
  }

  async function fetchTasks() {
    const response = await fetch("/api/tasks");
    if (!response.ok) return;
    const data = await response.json() as Task[] | { items?: Task[] };
    const nextTasks = Array.isArray(data) ? data : data.items ?? [];
    setTasks(nextTasks);
    if (!checkedRecovery.current) { checkedRecovery.current=true; setResumePrompt(nextTasks.find(task => task.status === "paused") || null); }
  }

  async function fetchProgress() {
    try {
      const response = await fetch("/api/process/progress");
      if (!response.ok) return null;
      const next = await response.json() as ProcessProgress;
      setProgress(next);
      return next;
    } catch {
      return null;
    }
  }

  async function refreshWallpaper() {
    const response = await fetch("/api/wallpaper/status");
    if (!response.ok) return;
    setWallpaper((await response.json()) as WallpaperStatus);
    const configuration = await (await fetch("/api/config")).json() as ApiConfig;
    const pool = await fetch(`/api/photos?collection=${configuration.wallpaperCollection}&wallpaperEligible=1&pageSize=12`);
    if (pool.ok) setWallpaperItems((await pool.json()).items);
  }

  async function selectDirectory() {
    try {
      const response = await fetch("/api/system/select-directory", { method: "POST" });
      const data = await response.json() as { path?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "目录选择失败。");
      if (data.path && draftConfig) {
        const next = { ...draftConfig, imageDir: data.path };
        setDraftConfig(next);
        const saved = await fetch("/api/config",{ method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(buildConfigPayload(next)) });
        if (!saved.ok) throw new Error((await saved.json()).error);
        await fetchConfig();
        setOnboardingStep(1);
        setMessage("照片目录已保存，可检查模型并试处理。");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目录选择失败。");
    }
  }

  async function checkModels() {
    try {
      const response = await fetch("/api/models/check", { method: "POST" });
      const data = await response.json() as { ok?: boolean; message?: string; models?: string[]; error?: string };
      setMessage(data.message ?? data.error ?? (data.ok ? "模型配置可用。" : "模型配置不可用。"));
      setOnboardingStep((step) => data.ok ? Math.max(step, 2) : step);
    } catch {
      setMessage("模型检查失败，请确认本地服务已启动。");
    }
  }

  async function startTask(body: Record<string, unknown>, label: string) {
    try {
      const response = await fetch("/api/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json() as { taskId?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "任务创建失败。");
      setMessage(label + (data.taskId ? "，任务已加入队列。" : "。"));
      setSection("tasks");
      await fetchTasks();
      return data.taskId ?? null;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "任务创建失败。");
      return null;
    }
  }

  async function processDirectory(mode: ProcessMode) {
    await startTask({ mode }, mode === "rerun" ? "已创建分析重跑任务" : "已创建新图处理任务");
  }

  async function processSelectedSources() {
    if (!selectedSourceIds.length && !selectAllResults) return;
    const body: Record<string, unknown> = { mode: "new" };
    if (selectAllResults) body.selection = { filters:selectionFilters };
    else body.sourceIds = selectedSourceIds;
    await startTask(body, "已创建选中图片处理任务");
    clearSelection();
  }

  async function startRerender() {
    const body: Record<string, unknown> = selectAllResults ? { mode: "rerender", selection: { filters:selectionFilters } } : { mode: "rerender" };
    if (!selectAllResults && selectedSourceIds.length) body.sourceIds = selectedSourceIds;
    try {
      const response = await fetch("/api/rerender", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json() as { taskId?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "重新渲染任务创建失败。");
      setMessage("已创建布局重渲染任务，人工编辑不会重新调用模型。");
      setSection("tasks");
      await fetchTasks();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重新渲染任务创建失败。");
    }
  }

  async function taskAction(id: string, action: "pause" | "resume" | "cancel" | "retry", sourceIds?: string[]) {
    const response = await fetch("/api/tasks/" + id + "/" + action, { method: "POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(sourceIds ? {sourceIds} : {}) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setMessage(data.error ?? "任务操作失败。");
      return;
    }
    setMessage(action === "pause" ? "任务已暂停。" : action === "resume" ? "任务已继续。" : action === "cancel" ? "任务已取消。" : "失败任务已重新加入队列。");
    await fetchTasks();
  }

  async function stopProcessing() {
    const response = await fetch("/api/process/stop", { method: "POST" });
    if (response.ok) {
      setMessage("已请求暂停当前任务，已完成的图片会保留。");
      await fetchTasks();
      await fetchProgress();
    } else {
      setMessage("暂停请求失败。");
    }
  }

  function clearSelection() {
    setSelectedSourceIds([]);
    setSelectAllResults(false);
    setSelectionFilters({});
  }

  function toggleSourceSelection(id: string, shift = false) {
    setSelectAllResults(false);
    if (shift && selectionAnchor.current) {
      const start = visibleSourceIds.indexOf(selectionAnchor.current);
      const end = visibleSourceIds.indexOf(id);
      if (start >= 0 && end >= 0) { setSelectedSourceIds(current => [...new Set([...current,...visibleSourceIds.slice(Math.min(start,end),Math.max(start,end)+1)])]); return; }
    }
    selectionAnchor.current = id;
    setSelectedSourceIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleVisibleSources() {
    setSelectedSourceIds((current) => allVisibleSourcesSelected ? current.filter((id) => !visibleSourceIds.includes(id)) : Array.from(new Set([...current, ...visibleSourceIds])));
  }

  function selectAllMatching() {
    setSelectionFilters(queryFilters);
    setSelectAllResults(true);
    setSelectedSourceIds([]);
    setMessage("已选择当前筛选结果，下一次批量操作会覆盖全部页。");
  }

  async function batchAction(action: "curated" | "wallpaperExcluded", value: boolean) {
    if (!selectedSourceIds.length && !selectAllResults) return;
    const body: Record<string, unknown> = { action, value };
    if (selectAllResults) body.selection = { filters:selectionFilters };
    else body.sourceIds = selectedSourceIds;
    const response = await fetch("/api/photos/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) setMessage(data.error ?? "批量更新失败。");
    else {
      setMessage("批量状态已保存。");
      clearSelection();
      await Promise.all([refreshSources(1), refreshGallery(1), fetchStats()]);
    }
  }

  async function openRandomMemory() {
    const count = stats?.processed || 0;
    if (!count) return;
    const response = await fetch(`/api/photos?collection=all&pageSize=1&page=${1+Math.floor(Math.random()*count)}`);
    const data = await response.json() as PageResult<GalleryImage>;
    if (data.items[0]) { setDetailPhoto(data.items[0]); setView({ type:"detail",id:data.items[0].id }); }
  }

  async function updatePhoto(id: string, payload: { manualEdits?: GalleryImage["manualEdits"]; restoreAI?: boolean; wallpaperExcluded?: boolean }) {
    const response = await fetch("/api/photos/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json() as GalleryImage & { error?: string };
    if (!response.ok) {
      setMessage(data.error ?? "照片修改失败。");
      return null;
    }
    setItems((current) => ({ ...current, items: current.items.map((item) => item.id === id ? data : item) }));
    setDetailPhoto(data);
    await fetchTasks();
    setMessage("照片修改已保存，已创建单图重渲染任务。");
    return data;
  }

  async function toggleCurated(item: GalleryImage) {
    await batchActionForIds("curated", !item.isCurated, [item.sourceId ?? item.id]);
  }

  async function batchActionForIds(action: "curated" | "wallpaperExcluded", value: boolean, sourceIds: string[]) {
    const response = await fetch("/api/photos/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceIds, action, value }) });
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: string };
      setMessage(data.error ?? "状态保存失败。");
      return;
    }
    await Promise.all([refreshGallery(page), fetchStats()]);
  }

  async function setWallpaperNow() {
    setIsSettingWallpaper(true);
    try {
      const response = await fetch("/api/wallpaper/random", { method: "POST" });
      const data = await response.json() as { fileName?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "壁纸设置失败。");
      setMessage("已设置壁纸" + (data.fileName ? "：" + data.fileName : "。"));
      await refreshWallpaper();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "壁纸设置失败。");
    } finally {
      setIsSettingWallpaper(false);
    }
  }

  async function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftConfig) return;
    setIsSavingConfig(true);
    try {
      const response = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildConfigPayload(draftConfig)) });
      const data = await response.json() as ApiConfig & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "保存配置失败。");
      setConfig(data);
      setDraftConfig(toDraft(data));
      setSettingsOpen(false);
      setMessage("配置已保存，布局保存不会自动触发批量重渲染。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存配置失败。");
    } finally {
      setIsSavingConfig(false);
    }
  }

  async function saveLayout(layoutTemplates: LayoutTemplates) {
    if (!draftConfig) return;
    const nextDraft = { ...draftConfig, layoutTemplates };
    setIsSavingConfig(true);
    try {
      const response = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildConfigPayload(nextDraft)) });
      const data = await response.json() as ApiConfig & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "布局保存失败。");
      setConfig(data);
      setDraftConfig(toDraft(data));
      setLayoutEditorOpen(false);
      setMessage("布局已保存。需要更新图片时，请在图库点击“重渲染”。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "布局保存失败。");
    } finally {
      setIsSavingConfig(false);
    }
  }

  async function openSource(source: SourcePhoto) {
    if (!source.processedId) { setSourcePreview(source); return; }
    const response = await fetch("/api/photos/"+source.processedId);
    if (!response.ok) { setMessage("无法打开照片详情"); return; }
    setDetailPhoto(await response.json());
    setView({type:"detail",id:source.processedId});
  }

  function changePage(nextPage: number) {
    if (nextPage < 1 || nextPage > Math.max(1, Math.ceil(total / pageSize))) return;
    setPage(nextPage);
    if (collection === "sources" || section === "manage") void refreshSources(nextPage);
    else void refreshGallery(nextPage);
  }

  if (selected) {
    const index = items.items.findIndex((item) => item.id === selected.id);
    return <PhotoDetail key={selected.id} item={selected} currentIndex={index} total={items.items.length} onBack={() => setView({ type: "gallery" })} onPrevious={() => index > 0 && setView({ type: "detail", id: items.items[index - 1].id })} onNext={() => index >= 0 && index < items.items.length - 1 && setView({ type: "detail", id: items.items[index + 1].id })} onToggleCurated={() => void toggleCurated(selected)} onSave={updatePhoto} onSetWallpaper={() => void postJson("/api/photos/"+selected.id+"/wallpaper").catch(error => setMessage(error.message))} onRepresentative={(representative) => void postJson("/api/photos/" + representative.id + "/representative").then(() => refreshGallery(page))} onSplitGroup={(id) => void postJson("/api/photos/" + id + "/split-group").then(() => refreshGallery(page))} />;
  }

  const hasLibrary = (stats?.processed ?? items.total) > 0;
  return (
    <main className="appFrame">
      <section className="appShell">
        <aside className="sidebar">
          <div className="brandBlock"><span className="appMark" aria-hidden="true" /><div><h1>InkTime Gallery</h1><p>照片记忆与壁纸</p></div></div>
          <nav className="libraryNav" aria-label="主导航">
            <button type="button" className={section === "review" ? "navItem active" : "navItem"} onClick={() => { setSection("review"); setCollection("curated"); }}><span>回看</span><b>{stats?.curated ?? 0}</b></button>
            <button type="button" className={section === "manage" ? "navItem active" : "navItem"} onClick={() => { setSection("manage"); setCollection("sources"); }}><span>照片管理</span><b>{stats?.original ?? 0}</b></button>
            <button type="button" className={section === "tasks" ? "navItem active" : "navItem"} onClick={() => setSection("tasks")}><span>任务</span><b>{tasks.filter((task) => ["queued", "running", "paused"].includes(task.status)).length}</b></button>
            <button type="button" className={section === "wallpaper" ? "navItem active" : "navItem"} onClick={() => setSection("wallpaper")}><span>壁纸</span><b>{wallpaper?.history?.length ?? 0}</b></button>
            <button type="button" className="navItem" onClick={() => setSettingsOpen(true)}><span>设置</span><Settings2 size={16} /></button>
          </nav>
          <div className="sidebarStats"><div><span>未处理</span><strong>{stats?.pending ?? "--"}</strong></div><div><span>失败</span><strong>{stats?.failed ?? "--"}</strong></div><div><span>精选</span><strong>{stats?.curated ?? "--"}</strong></div></div>
          <div className="sidebarMeta"><span>{config?.model ?? "--"}</span><span>{config?.promptVersion ?? "--"}</span><span title={databasePath}>{databasePath}</span></div>

        </aside>

        <section className="workspace">
          <header className="topBar">
            <div className="titleBlock"><h2>{section === "review" ? "回看" : section === "manage" ? "照片管理" : section === "tasks" ? "任务中心" : "壁纸"}</h2><p title={config?.imageDir ?? ""}>{section === "review" ? "从精选照片开始，按时间和回忆度慢慢回看。" : config?.imageDir ?? "还没有设置图片目录"}</p></div>
            <div className="actionCluster">
              {section === "manage" ? <><button type="button" className="secondaryAction" onClick={() => void startTask({ mode: "new" }, "已创建扫描后处理任务")}><Images size={15} /> 处理新图</button><button type="button" className="primaryAction" onClick={() => void processSelectedSources()} disabled={!selectedSourceIds.length && !selectAllResults}><RefreshCw size={15} /> 处理选择</button></> : null}
              {section === "review" ? <><button type="button" className="secondaryAction" onClick={() => void setWallpaperNow()} disabled={isSettingWallpaper || !items.items.length}><Sparkles size={15} /> {isSettingWallpaper ? "设置中" : "随机壁纸"}</button><button type="button" className="primaryAction" onClick={() => void processDirectory("new")}><RefreshCw size={15} /> 处理新图</button></> : null}
              {section === "tasks" && runningTask ? <button type="button" className="dangerAction" onClick={() => void stopProcessing()}><Pause size={15} /> 暂停当前</button> : null}
              {section === "wallpaper" ? <button type="button" className="primaryAction" onClick={() => void setWallpaperNow()} disabled={isSettingWallpaper}><Sparkles size={15} /> 立即换一张</button> : null}
            </div>
          </header>

          {resumePrompt ? <section className="recoveryPrompt" role="status"><p>上次有未完成任务，已保留进度。是否继续？</p><button onClick={() => { void taskAction(resumePrompt.id,"resume"); setResumePrompt(null); }}>继续处理</button><button onClick={() => { setResumePrompt(null); setSection("tasks"); }}>稍后，在任务中心查看</button></section> : null}
          {message && section !== "review" && section !== "manage" ? <p className="statusLine" role="status">{message}</p> : null}
          {section === "tasks" ? <TaskCenter tasks={tasks} progress={progress} onAction={taskAction} /> : null}
          {section === "wallpaper" ? <><section className="reviewModes"><button onClick={() => setLayoutEditorOpen(true)}>编辑相框布局</button><button onClick={() => void startRerender()}>批量重渲染</button><button onClick={() => setSettingsOpen(true)}>候选池与轮换设置</button></section><WallpaperPage status={wallpaper} items={wallpaperItems} onSet={setWallpaperNow} /></> : null}
          {section === "review" || section === "manage" ? (
            <>
              {!hasLibrary && section === "manage" ? <Onboarding step={onboardingStep} onChoose={selectDirectory} onCheckModels={checkModels} onSample={() => void startTask({ mode: "new", limit: 3 }, "已创建 3 张试处理任务")} /> : null}
              <section className="reviewModes">{section === "review" ? <><button className={collection === "curated" ? "active" : ""} onClick={() => setCollection("curated")}>精选</button><button onClick={() => { setCollection("all"); setSortMode("capture"); setDateTo(""); setDateFrom(""); setMonth("all"); setDay("all"); }}>时间线</button><button onClick={() => { const today = new Date(); setCollection("all"); setMonth(today.getMonth()+1); setDay(today.getDate()); setDateFrom(""); setDateTo(`${today.getFullYear()-1}-12-31`); }}>往年今日</button><button onClick={() => { void openRandomMemory(); }}>随机回看</button></> : <button onClick={() => void fetch("/api/sources/scan",{method:"POST"}).then(async response => { const data=await response.json(); setMessage(response.ok ? `扫描完成：新增/变化 ${data.changed} · 未变化 ${data.unchanged} · 无法读取 ${data.errors?.length || 0}` : data.error); await refreshSources(1); await fetchStats(); })}>扫描目录</button>}</section>
              <section className="filterBar" aria-label="筛选与操作">
                <label>起始日期<input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} /></label><label>结束日期<input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} /></label>
                <label>月份<select value={month} onChange={(event) => { setMonth(event.target.value === "all" ? "all" : Number(event.target.value)); setPage(1); }}>{[<option key="all" value="all">全部</option>, ...monthOptions.map((value) => <option key={value} value={value}>{value} 月</option>)]}</select></label>
                <label>日期<select value={day} onChange={(event) => { setDay(event.target.value === "all" ? "all" : Number(event.target.value)); setPage(1); }}>{[<option key="all" value="all">全部</option>, ...dayOptions.map((value) => <option key={value} value={value}>{value} 日</option>)]}</select></label>
                {section === "manage" ? <label>状态<select value={sourceStatus} onChange={(event) => setSourceStatus(event.target.value as SourceStatus)}><option value="all">全部状态</option><option value="pending">未处理</option><option value="processed">已处理</option><option value="skipped">已跳过</option><option value="failed">失败</option><option value="processing">处理中</option></select></label> : <label>排序<select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}><option value="memory">按回忆度</option><option value="newest">按处理时间</option><option value="capture">按拍摄时间</option></select></label>}
                <label className="filterSearch">地点<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="筛选地点" /></label>
                <label>最低回忆度<input type="number" min="0" max="100" value={minScore} onChange={event => setMinScore(event.target.value === "" ? "" : Number(event.target.value))} /></label><label>最高回忆度<input type="number" min="0" max="100" value={maxScore} onChange={event => setMaxScore(event.target.value === "" ? "" : Number(event.target.value))} /></label><div className="filterActions"><button type="button" onClick={() => { setMonth("all"); setDay("all"); setDateTo(""); setDateFrom(""); setLocation(""); setMinScore(""); setMaxScore(""); }}><Home size={15} /> 清除筛选</button><button type="button" onClick={() => void startRerender()} disabled={!items.items.length}><Sparkles size={15} /> 重渲染</button></div>
              </section>
              {section === "manage" ? <SelectionToolbar selectedCount={selectAllResults ? -1 : selectedSourceIds.length} allSelected={selectAllResults} currentPageSelected={allVisibleSourcesSelected} onTogglePage={toggleVisibleSources} onSelectAll={selectAllMatching} onClear={clearSelection} onCurated={(value) => void batchAction("curated", value)} onWallpaper={(value) => void batchAction("wallpaperExcluded", value)} onProcess={() => void processSelectedSources()} /> : null}
              <div className="summaryStrip"><span>当前页 <strong>{activeItems.length}</strong> / 共 <strong>{total}</strong> 张</span><span>{selectAllResults ? "已选择全部筛选结果" : "已选择 " + selectedSourceIds.length + " 张"}</span><span>{config?.apiKeyEnvName ? "API Key " + (config.apiKeyConfigured ? "已读取" : "未读取") : "本地模型模式"}</span></div>
              {message ? <p className="statusLine" aria-live="polite">{message}</p> : null}
              {section === "manage" ? <SourceList sources={sources.items} selectedIds={selectedSourceIds} onToggle={toggleSourceSelection} onOpen={(source) => void openSource(source)} /> : <VirtualPhotoGrid items={items.items} onOpen={(item) => setView({ type: "detail", id: item.id })} />}
              <Pagination page={page} pageSize={pageSize} total={total} onChange={changePage} />
            </>
          ) : null}
        </section>
      </section>

      {sourcePreview ? <div className="settingsOverlay"><section className="sourcePreviewDialog" role="dialog" aria-modal="true" aria-label="照片预览"><button type="button" onClick={() => setSourcePreview(null)}>关闭预览</button><img src={sourcePreview.sourceUrl} alt={sourcePreview.fileName} /><h3>{sourcePreview.fileName}</h3><p>{sourcePreview.skipReason || sourceStatusLabel(sourcePreview.status)}</p><button type="button" onClick={() => { void startTask({ sourceIds:[sourcePreview.id] },"已创建单图处理任务"); setSourcePreview(null); }}>处理这张照片</button></section></div> : null}
      {settingsOpen && draftConfig ? <SettingsPanel config={config} draft={draftConfig} isSaving={isSavingConfig} onChange={setDraftConfig} onSubmit={saveConfig} onClose={() => setSettingsOpen(false)} onOpenLayout={() => setLayoutEditorOpen(true)} /> : null}
      {layoutEditorOpen && draftConfig ? <LayoutEditor templates={draftConfig.layoutTemplates} sampleUrls={buildLayoutSampleUrls(sources.items, items.items)} onChange={(layoutTemplates) => setDraftConfig((current) => current ? { ...current, layoutTemplates } : current)} onSave={(layoutTemplates) => void saveLayout(layoutTemplates)} onClose={() => setLayoutEditorOpen(false)} /> : null}
    </main>
  );
}

function normalizePage<T>(data: PageResult<T> | T[], page: number, pageSize: number): PageResult<T> {
  if (Array.isArray(data)) return { items: data, total: data.length, page, pageSize };
  return { items: Array.isArray(data.items) ? data.items : [], total: Number(data.total ?? data.items?.length ?? 0), page: Number(data.page ?? page), pageSize: Number(data.pageSize ?? pageSize) };
}

function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return <div className="pagination"><button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft size={15} /> 上一页</button><span>第 {page} / {pageCount} 页</span><button type="button" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>下一页 <ChevronRight size={15} /></button></div>;
}

function VirtualWindow<T>({ entries, columns = 1, rowHeight, render }: { entries: T[]; columns?: number; rowHeight: number; render: (entry: T,index: number) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop,setScrollTop] = useState(0);
  const [width,setWidth] = useState(1000);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  },[]);
  useEffect(() => { setScrollTop(0); if (ref.current) ref.current.scrollTop=0; },[entries]);
  const count = columns === 1 ? 1 : Math.max(1,Math.min(columns,Math.floor(width/250)));
  const start = Math.max(0,Math.floor(scrollTop/rowHeight)-1)*count;
  const end = Math.min(entries.length,start+(Math.ceil(620/rowHeight)+3)*count);
  return <div className="virtualViewport" ref={ref} onScroll={event => setScrollTop(event.currentTarget.scrollTop)}><div style={{height:Math.ceil(entries.length/count)*rowHeight,position:"relative"}}><div className="virtualRows" style={{position:"absolute",top:Math.floor(start/count)*rowHeight,width:"100%",display:"grid",gridTemplateColumns:`repeat(${count},minmax(0,1fr))`,gridAutoRows:rowHeight,gap:0}}>{entries.slice(start,end).map((entry,index) => render(entry,start+index))}</div></div></div>;
}

function VirtualPhotoGrid({ items, onOpen }: { items: GalleryImage[]; onOpen: (item: GalleryImage) => void }) {
  if (!items.length) return <section className="emptyPanel"><h2>这里还没有照片</h2><p>试试时间线、清除筛选，或到照片管理导入新图。</p></section>;
  return <VirtualWindow entries={items} columns={4} rowHeight={320} render={item => <button className="photoCard" type="button" key={item.id} onClick={() => onOpen(item)}><div className="photoThumb"><img loading="lazy" src={item.thumbnailUrl} alt={item.fileName} /></div><div className="photoMeta"><strong>{item.sideCaption || item.caption || "未生成短句"}</strong><span>{item.capturedDate || "日期未知"}{item.location ? " · " + item.location : ""}</span>{item.isCurated ? <span>精选</span> : null}</div></button>} />;
}

function SourceList({ sources, selectedIds, onToggle, onOpen }: { sources: SourcePhoto[]; selectedIds: string[]; onToggle: (id: string,shift?: boolean) => void; onOpen: (source: SourcePhoto) => void }) {
  if (!sources.length) return <section className="emptyPanel"><h2>这里还没有图片</h2><p>扫描照片目录或清除筛选以查看图片。</p></section>;
  return <VirtualWindow entries={sources} rowHeight={104} render={source => <article className={selectedIds.includes(source.id) ? "sourceRow selected" : "sourceRow"} key={source.id}><button type="button" className="sourceCheck" onClick={event => onToggle(source.id,event.shiftKey)} aria-label={"选择 " + source.fileName}>{selectedIds.includes(source.id) ? <CheckSquare size={18} /> : <Square size={18} />}</button><button type="button" className="sourcePreviewButton" onClick={event => event.metaKey || event.ctrlKey || event.shiftKey ? onToggle(source.id,event.shiftKey) : onOpen(source)}><img loading="lazy" src={source.thumbnailUrl} alt={source.fileName} /></button><div className="sourceInfo"><strong>{source.fileName}</strong><span title={source.sourcePath}>{source.sourcePath}</span><span>{source.manualEdits?.sideCaption ?? source.caption ?? source.skipReason ?? formatSourceMeta(source)}</span></div><div className="sourceState"><b className={"statusPill " + source.status}>{sourceStatusLabel(source.status)}</b><span>{source.wallpaperExcluded ? "已排除壁纸" : source.memoryScore !== null ? "回忆度 " + source.memoryScore.toFixed(1) : source.skipReason || "等待处理"}</span></div></article>} />;
}

function SelectionToolbar({ selectedCount, allSelected, currentPageSelected, onTogglePage, onSelectAll, onClear, onCurated, onWallpaper, onProcess }: { selectedCount: number; allSelected: boolean; currentPageSelected: boolean; onTogglePage: () => void; onSelectAll: () => void; onClear: () => void; onCurated: (value: boolean) => void; onWallpaper: (value: boolean) => void; onProcess: () => void }) {
  return <div className="selectionToolbar"><button type="button" onClick={onTogglePage}>{currentPageSelected ? <CheckSquare size={15} /> : <Square size={15} />} {currentPageSelected ? "取消本页" : "选择本页"}</button><button type="button" onClick={onSelectAll}>选择全部筛选结果</button><button type="button" onClick={onClear} disabled={!selectedCount && !allSelected}><X size={15} /> 清空</button><span>{allSelected ? "全部筛选结果" : selectedCount + " 张已选"}</span><button type="button" onClick={onProcess} disabled={!selectedCount && !allSelected}><RefreshCw size={15} /> 处理</button><button type="button" onClick={() => onCurated(true)} disabled={!selectedCount && !allSelected}>加入精选</button><button type="button" onClick={() => onCurated(false)} disabled={!selectedCount && !allSelected}>移出精选</button><button type="button" onClick={() => onWallpaper(true)} disabled={!selectedCount && !allSelected}>排除壁纸</button></div>;
}

function TaskCenter({ tasks, progress, onAction }: { tasks: Task[]; progress: ProcessProgress | null; onAction: (id: string, action: "pause" | "resume" | "cancel" | "retry", sourceIds?: string[]) => void }) {
  const [details,setDetails] = useState<Record<string, Array<{sourceId:string;fileName:string;status:string;stage:string;error:string}>>>({});
  useEffect(() => { for (const id of Object.keys(details)) void loadDetails(id); },[tasks]);
  const loadDetails = async (id:string) => { const response=await fetch("/api/tasks/"+id); const data=await response.json(); if (response.ok) setDetails(current => ({...current,[id]:[...(data.items || []),...(data.scanReport?.errors || []).map((entry:{file:string;message:string}) => ({sourceId:"",fileName:entry.file,status:"scan-error",stage:"scan",error:entry.message}))]})); };
  return <section className="taskCenter">{progress && progress.status !== "idle" ? <div className="progressPanel"><div className="progressHeader"><strong>{progress.message || "处理状态"}</strong><span>{progress.total ? progress.done + "/" + progress.total : ""}</span></div><div className="progressTrack"><i style={{ width: (progress.total ? Math.round((progress.done / progress.total) * 100) : 0) + "%" }} /></div><div className="progressMeta"><span>{progress.currentFile || " "}</span><span>{progress.stage || progress.status}</span></div></div> : null}{progress?.aguiEvents?.length ? <details><summary>技术日志</summary>{progress.aguiEvents.slice(-20).map(event => <p key={event.id}>{event.kind} · {event.text}</p>)}</details> : null}{tasks.length ? tasks.map((task) => <article className="taskCard" key={task.id}><div><strong>{task.message || task.mode}</strong><span>{task.currentFile || task.stage || "等待执行"} · {task.createdAt ? new Date(task.createdAt).toLocaleString("zh-CN") : ""}</span></div><div className="taskStats"><b>{task.done}/{task.total}</b><span>成功 {task.succeeded} / 失败 {task.failed}{task.scanErrors ? ` / 扫描不可读 ${task.scanErrors}` : ""}</span></div><div className="taskActions">{task.status === "running" || task.status === "queued" ? <button type="button" onClick={() => onAction(task.id, "pause")}><Pause size={14} />暂停</button> : null}{task.status === "paused" ? <button type="button" onClick={() => onAction(task.id, "resume")}><Play size={14} />继续</button> : null}{["queued", "running", "paused"].includes(task.status) ? <button type="button" onClick={() => onAction(task.id, "cancel")}><Trash2 size={14} />取消</button> : null}{(task.status === "error" || task.failed > 0) ? <button type="button" onClick={() => onAction(task.id, "retry")}><RotateCcw size={14} />重试</button> : null}<b className={"taskStatus " + task.status}>{taskStatusLabel(task.status)}</b></div><details onToggle={event => { if (event.currentTarget.open) void loadDetails(task.id); }}><summary>逐图状态与失败原因</summary>{(details[task.id] || []).filter(entry => entry.error || entry.status === "running").slice(0,100).map((entry,index) => <p key={index}>{entry.fileName} · {entry.stage} · {entry.error || entry.status}{entry.status === "failed" && !["running","queued"].includes(task.status) ? <button onClick={() => onAction(task.id,"retry",[entry.sourceId])}>重试这张</button> : null}</p>)}<p>可在照片管理按状态筛选全部图片，重试只处理失败项。</p></details></article>) : <section className="emptyPanel"><h2>还没有处理任务</h2><p>处理新图、批量重跑和布局重渲染都会出现在这里。</p></section>}</section>;
}

function WallpaperPage({ status, items, onSet }: { status: WallpaperStatus | null; items: GalleryImage[]; onSet: () => void }) {
  return <section className="wallpaperPage"><div className="wallpaperHero"><div className="wallpaperPreview" style={{aspectRatio:status?.screen ? `${status.screen.width} / ${status.screen.height}` : "16 / 10"}}>{status?.current ? <img src={status.current.url} alt="当前壁纸" /> : <span>尚未设置壁纸</span>}</div><div><h3>桌面壁纸</h3><p>{status?.nextUpdateAt ? "下一次更新：" + new Date(status.nextUpdateAt).toLocaleString("zh-CN") : "自动换壁纸尚未安排"}</p><p>{status?.screen ? "主屏 " + status.screen.width + " × " + status.screen.height : "等待显示器信息"}</p><button type="button" className="primaryAction" onClick={onSet}><Sparkles size={15} /> 立即换一张</button></div></div><div className="wallpaperHistory"><h3>近期历史</h3>{status?.history?.length ? status.history.map((entry, index) => <div className="historyRow" key={entry.at || String(index)}><span>{entry.fileName || entry.url || "壁纸"}</span><time>{(entry.setAt || entry.at) ? new Date(entry.setAt || entry.at || "").toLocaleString("zh-CN") : ""}</time></div>) : <p className="settingsHint">还没有壁纸历史。</p>}</div>{status?.lastError ? <p className="statusLine dangerText">上次失败：{status.lastError}</p> : null}<div className="wallpaperPool"><h3>当前候选池</h3><div className="miniGrid">{items.slice(0, 12).map((item) => <div className="miniCard" key={item.id}><img loading="lazy" src={item.thumbnailUrl || item.sourceUrl} alt={item.fileName} /><span>{item.wallpaperExcluded ? "已排除" : item.isCurated ? "精选" : "候选"}</span></div>)}</div></div></section>;
}

function Onboarding({ step, onChoose, onCheckModels, onSample }: { step: number; onChoose: () => void; onCheckModels: () => void; onSample: () => void }) {
  return <section className="onboarding"><div className={"onboardingStep " + (step >= 0 ? "active" : "")}><b>1</b><div><strong>选择照片目录</strong><p>使用系统目录选择器，照片路径只保存在本机。</p><button type="button" onClick={onChoose}><FolderOpen size={15} />选择目录</button></div></div><div className={"onboardingStep " + (step >= 1 ? "active" : "")}><b>2</b><div><strong>检查模型</strong><p>不会自动下载模型，先确认 Ollama 或云端配置可用。</p><button type="button" onClick={onCheckModels}>检查模型</button></div></div><div className={"onboardingStep " + (step >= 2 ? "active" : "")}><b>3</b><div><strong>试处理 3 张</strong><p>先查看结果，再决定是否批量处理与开启壁纸。</p><button type="button" onClick={onSample}>试处理 3 张</button></div></div></section>;
}

function taskStatusLabel(status: TaskStatus): string {
  if (status === "queued") return "排队中";
  if (status === "running") return "处理中";
  if (status === "paused") return "已暂停";
  if (status === "done") return "已完成";
  if (status === "cancelled") return "已取消";
  return "失败";
}

function SettingsPanel({ config, draft, isSaving, onChange, onSubmit, onClose }: {
  config: ApiConfig | null; draft: ConfigDraft; isSaving: boolean;
  onChange: (draft: ConfigDraft) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void; onOpenLayout: () => void;
}) {
  const [backups, setBackups] = useState<Array<{ fileName: string; size: number }>>([]);
  const [notice, setNotice] = useState("");
  const [backupName, setBackupName] = useState("");
  useEffect(() => { void fetch("/api/library/backups").then(res => res.json()).then(setBackups); }, []);
  const operation = async (action: string) => {
    if (action === "restore" && !window.confirm("恢复此备份会替换当前台账；恢复前会自动备份当前台账。继续？")) return;
    const response = await fetch("/api/library/"+action, { method:action === "health" ? "GET" : "POST",headers:{ "Content-Type":"application/json" },body:action === "restore" ? JSON.stringify({ fileName:backupName }) : undefined });
    const result = await response.json();
    if (!response.ok) { setNotice(result.error || "操作失败"); return; }
    setNotice(action === "health" ? `数据库 ${result.integrity} · 缺失原图 ${result.missingSources.length} · 缺失派生图 ${result.missingRenders.length}` : action === "restore" ? "已恢复，重新打开页面以加载台账" : "备份已创建");
    setBackups(await (await fetch("/api/library/backups")).json());
  };
  const textField = (key: keyof ConfigDraft, label: string, type = "text") => <label>{label}<input type={type} value={String(draft[key] ?? "")} onChange={event => onChange({ ...draft,[key]:type === "number" ? Number(event.target.value) : event.target.value })} /></label>;
  return <div className="settingsOverlay"><aside className="settingsDrawer" role="dialog" aria-modal="true" aria-label="设置">
    <div className="settingsHeader"><h2>设置</h2><button type="button" className="iconOnly" onClick={onClose} aria-label="关闭设置"><X size={20} /></button></div>
    <form onSubmit={onSubmit} className="settingsForm">
      <fieldset><legend>照片与模型</legend>
        {textField("imageDir","照片目录")}{textField("providerBaseUrl","模型接口")}{textField("model","模型")}{textField("apiKeyEnvName","API Key 环境变量名称")}
        <p className="settingsHint">{config?.apiKeyConfigured ? "已读取密钥" : "本地模型无需密钥；云端密钥存放在本机 .env.local"}</p>
        <label>模型候选<textarea value={draft.modelOptionsText} onChange={event => onChange({ ...draft,modelOptionsText:event.target.value })} /></label>
        {textField("maxImagesPerRun","每次处理上限","number")}{textField("maxConcurrentImages","并发数","number")}
        <label className="checkLabel"><input type="checkbox" checked={draft.excludeScreenshots} onChange={event => onChange({ ...draft,excludeScreenshots:event.target.checked })} />跳过截图</label>
        <label>截图名称规则<textarea value={draft.excludeNamePatternsText} onChange={event => onChange({ ...draft,excludeNamePatternsText:event.target.value })} /></label>
      </fieldset>
      <fieldset><legend>自动壁纸</legend><label>候选池<select value={draft.wallpaperCollection} onChange={event => onChange({ ...draft,wallpaperCollection:event.target.value as ApiConfig["wallpaperCollection"] })}><option value="curated">精选</option><option value="representative">代表照片</option><option value="all">全部分析结果</option></select></label>
        <label>整点轮换<select value={draft.wallpaperAutoIntervalHours} onChange={event => onChange({ ...draft,wallpaperAutoIntervalHours:Number(event.target.value) })}><option value={0}>关闭</option>{[1,2,4,8].map(value => <option key={value} value={value}>每 {value} 小时</option>)}</select></label>
        {textField("wallpaperWidth","预览宽度","number")}{textField("wallpaperHeight","预览高度","number")}
      </fieldset>
      <details><summary>分析提示词</summary>{textField("promptVersion","版本")}<label>照片分析<textarea rows={8} value={draft.scoringPrompt} onChange={event => onChange({ ...draft,scoringPrompt:event.target.value })} /></label><label>短句<textarea rows={5} value={draft.sideCaptionPrompt} onChange={event => onChange({ ...draft,sideCaptionPrompt:event.target.value })} /></label></details>
      <button type="submit" className="primaryAction" disabled={isSaving}>{isSaving ? "保存中" : "保存设置"}</button>
    </form>
    <fieldset><legend>备份与检查</legend><p>备份包含台账与人工修改；原图和派生图片仍保留在原目录。</p><button type="button" onClick={() => void operation("backup")}>创建备份</button><button type="button" onClick={() => void operation("health")}>检查缺失文件</button><select aria-label="选择备份" value={backupName} onChange={event => setBackupName(event.target.value)}><option value="">选择备份</option>{backups.map(item => <option value={item.fileName} key={item.fileName}>{item.fileName}</option>)}</select><button type="button" disabled={!backupName} onClick={() => void operation("restore")}>恢复备份</button><p role="status">{notice}</p></fieldset>
  </aside></div>;
}

function PhotoDetail({ item, currentIndex, total, onBack, onPrevious, onNext, onToggleCurated, onSave, onSetWallpaper, onRepresentative, onSplitGroup }: { item: GalleryImage; currentIndex: number; total: number; onBack: () => void; onPrevious: () => void; onNext: () => void; onToggleCurated: () => void; onSave: (id: string, payload: { manualEdits?: GalleryImage["manualEdits"]; restoreAI?: boolean; wallpaperExcluded?: boolean }) => Promise<GalleryImage | null>; onSetWallpaper: () => void; onRepresentative: (item: GalleryImage) => void; onSplitGroup: (id: string) => void }) {
  const [related,setRelated] = useState<GalleryImage[]>([]);
  const [notice,setNotice] = useState("");
  useEffect(() => {
    if (!item.similarGroupId) { setRelated([]); return; }
    void fetch("/api/photos?collection=all&groupId="+encodeURIComponent(item.similarGroupId)).then(response => response.json()).then(data => setRelated(data.items || []));
  },[item.similarGroupId]);
  const [caption, setCaption] = useState(item.manualEdits?.sideCaption || item.sideCaption || "");
  const [capturedDate, setCapturedDate] = useState(item.manualEdits?.capturedDate || item.capturedDate || "");
  const [place, setPlace] = useState(item.manualEdits?.location || item.location || "");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setCaption(item.sideCaption || ""); setCapturedDate(item.capturedDate || ""); setPlace(item.location || ""); },[item.sideCaption,item.capturedDate,item.location]);
  const save = async () => { setSaving(true); const result=await onSave(item.id, { manualEdits: { sideCaption: caption, ...(capturedDate ? {capturedDate} : {}), location: place } }); setNotice(result ? "已保存，渲染任务已加入队列" : "保存失败，请返回查看提示"); setSaving(false); };
  return <main className="appFrame"><section className="simPage"><div className="renderColumn"><img src={item.renderedUrl || item.sourceUrl} alt={item.fileName} /></div><article className="insightPanel"><div className="detailActions"><button className="backButton" type="button" onClick={onBack}><ArrowLeft size={16} />返回</button><button className="backButton" type="button" onClick={onPrevious} disabled={currentIndex <= 0}>上一张</button><button className="backButton" type="button" onClick={onNext} disabled={currentIndex < 0 || currentIndex >= total - 1}>下一张</button></div><div className="detailActions"><button className={"backButton curatedToggle " + (item.isCurated ? "active" : "")} type="button" onClick={onToggleCurated}><Sparkles size={16} />{item.isCurated ? "已精选" : "加入精选"}</button><button className="backButton" type="button" onClick={onSetWallpaper}>设为壁纸</button></div>{notice ? <p role="status">{notice}</p> : null}<p className="shortcutHint">{currentIndex + 1} / {total} · ← / → 切换</p><h1>{item.manualEdits?.sideCaption || item.sideCaption || item.caption}</h1><div className="tagRow">{item.tags?.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="editCard"><h3>编辑结果</h3><label>短句<input value={caption} onChange={(event) => setCaption(event.target.value)} /></label><label>日期<input type="date" value={capturedDate} onChange={(event) => setCapturedDate(event.target.value)} /></label><label>地点<input value={place} onChange={(event) => setPlace(event.target.value)} /></label><div className="detailActions"><button type="button" className="primaryAction" onClick={() => void save()} disabled={saving}>{saving ? "保存中" : "保存并重渲染"}</button><button type="button" className="secondaryAction" onClick={() => void onSave(item.id, { restoreAI: true })}>恢复 AI 内容</button></div></div><div className="detailActions"><button type="button" className="secondaryAction" onClick={() => void onSave(item.id, { wallpaperExcluded: !item.wallpaperExcluded })}>{item.wallpaperExcluded ? "允许进入壁纸" : "永不作为壁纸"}</button>{item.similarGroupId ? <><button type="button" className="secondaryAction" onClick={() => onRepresentative(item)}>设为连拍代表</button><button type="button" className="secondaryAction" onClick={() => onSplitGroup(item.id)}>拆分连拍组</button></> : null}</div><p>{item.caption}</p><ScoreBar label="回忆度" value={Number(item.scores?.memory ?? 0)} className="memory" /><div className="reasonBox"><strong>评分理由：</strong>{item.reason}</div><footer><span>{item.sourcePath}</span><a href={item.renderedUrl || item.sourceUrl} download><Download size={15} />下载渲染图</a></footer>{related.length > 1 ? <section className="relatedGroup"><h3>同组照片 · 选择代表</h3>{related.map(candidate => <button key={candidate.id} onClick={() => onRepresentative(candidate)}><img src={candidate.thumbnailUrl} alt={candidate.fileName} /><span>{candidate.isRepresentative ? "当前代表" : "设为代表"}</span></button>)}</section> : null}</article></section></main>;
}

function LayoutEditor({
  templates,
  sampleUrls,
  onChange,
  onSave,
  onClose,
}: {
  templates: LayoutTemplates;
  sampleUrls: string[];
  onChange: (templates: LayoutTemplates) => void;
  onSave: (templates: LayoutTemplates) => void;
  onClose: () => void;
}) {
  const [history,setHistory] = useState<LayoutTemplates[]>([]);
  const [previewUrl,setPreviewUrl] = useState("");
  const [previewError,setPreviewError] = useState("");
  const record = () => setHistory(current => [...current.slice(-49),structuredClone(templates)]);
  const undo = () => { const previous=history.at(-1); if (previous) { onChange(previous); setHistory(current => current.slice(0,-1)); } };
  const preview = async () => {
    const response=await fetch("/api/layout/preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({layoutTemplates:templates})});
    const data=await response.json();
    if (response.ok) { setPreviewUrl(data.url); setPreviewError(""); } else setPreviewError(data.error);
  };
  const [frame, setFrame] = useState<FrameKind>("portrait");
  const [selectedLayer, setSelectedLayer] = useState<LayoutElementKey>("photo");
  const [sampleIndex, setSampleIndex] = useState(0);
  const [drag, setDrag] = useState<null | {
    mode: "move" | "resize";
    layer: LayoutElementKey;
    startX: number;
    startY: number;
    start: LayoutElement;
  }>(null);
  const template = templates[frame];
  const element = template.elements[selectedLayer];
  const sampleUrl = sampleUrls[sampleIndex % Math.max(1, sampleUrls.length)] || "";

  function updateTemplate(nextTemplate: LayoutTemplate) {
    if (!drag) record();
    onChange({ ...templates, [frame]: nextTemplate });
  }

  function updateElement(layer: LayoutElementKey, patch: Partial<LayoutElement>) {
    const nextElement = constrainLayoutElement({ ...template.elements[layer], ...patch }, template);
    updateTemplate({
      ...template,
      elements: {
        ...template.elements,
        [layer]: nextElement,
      },
    });
  }

  function startDrag(event: ReactPointerEvent, layer: LayoutElementKey, mode: "move" | "resize") {
    event.preventDefault();
    event.stopPropagation();
    setSelectedLayer(layer);
    record();
    setDrag({ mode, layer, startX: event.clientX, startY: event.clientY, start: { ...template.elements[layer] } });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent) {
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / stageScale;
    const dy = (event.clientY - drag.startY) / stageScale;
    if (drag.mode === "resize") {
      updateElement(drag.layer, {
        width: Math.max(24, Math.min(template.width - (drag.start.x || 0), Math.round((drag.start.width || 0) + dx))),
        height: Math.max(20, Math.min(template.height - (drag.start.y || 0), Math.round((drag.start.height || 0) + dy))),
      });
      return;
    }
    const width = drag.start.width || 0;
    const height = drag.start.height || 0;
    let x = Math.round((drag.start.x || 0) + dx);
    let y = Math.round((drag.start.y || 0) + dy);
    x = snap(x + width / 2, template.width / 2) - width / 2;
    y = snap(y + height / 2, template.height / 2) - height / 2;
    updateElement(drag.layer, {
      x: Math.max(0, Math.min(template.width - width, Math.round(x))),
      y: Math.max(0, Math.min(template.height - height, Math.round(y))),
    });
  }

  const stageScale = Math.min(1, 620 / template.width, 720 / template.height);

  return (
    <div className="layoutOverlay">
      <section className="layoutEditor">
        <aside className="layoutSide">
          <div className="layoutHeader">
            <strong>相框布局</strong>
            <button type="button" className="iconOnly" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
          <div className="layoutGroup">
            <span>模板</span>
            {(["portrait", "landscape", "square"] as FrameKind[]).map((option) => (
              <button type="button" className={frame === option ? "active" : ""} key={option} onClick={() => setFrame(option)}>
                {frameLabel(option)}
              </button>
            ))}
          </div>
          <div className="layoutGroup">
            <span>样张</span>
            {[0, 1, 2].map((index) => (
              <button type="button" className={sampleIndex === index ? "active" : ""} key={index} onClick={() => setSampleIndex(index)}>
                样张 {index + 1}
              </button>
            ))}
          </div>
          <div className="layoutGroup">
            <span>图层</span>
            {layoutLayers.map((layer) => (
              <button
                type="button"
                className={`${selectedLayer === layer ? "active" : ""} ${template.elements[layer].visible === false ? "muted" : ""}`}
                key={layer}
                onClick={() => setSelectedLayer(layer)}
              >
                {layerLabel(layer)}
                {template.elements[layer].visible === false ? "（已隐藏）" : ""}
              </button>
            ))}
          </div>
        </aside>

        <main className="layoutCanvasPanel">
          <div className="layoutToolbar">
            <div>
              <strong>拖拽移动，右下角缩放</strong>
              <span>保存设置后点击重渲染，图库相框会应用新模板。</span>
            </div>
            <button type="button" onClick={undo} disabled={!history.length}>撤销</button>
            <button type="button" onClick={() => updateElement(selectedLayer,{x:Math.round((template.width-element.width)/2),y:Math.round((template.height-element.height)/2)})}>居中对齐</button>
            <button type="button" onClick={() => void preview()}>预览一张</button>
            <button type="button" className="primaryAction" onClick={() => onSave(templates)}>
              保存布局
            </button>
          </div>
          {previewError ? <p role="status">{previewError}</p> : null}
          {previewUrl ? <div className="singlePreview"><button type="button" onClick={() => setPreviewUrl("")}>返回编辑</button><img src={previewUrl} alt="单张实际渲染预览" /></div> : null}
          <div className="layoutStageWrap" onPointerMove={moveDrag} onPointerUp={() => setDrag(null)}>
            <div
              className="layoutStage"
              style={{ width: template.width, height: template.height, background: template.background, transform: `scale(${stageScale})` }}
            >
              <i className="layoutGuideH" />
              <i className="layoutGuideV" />
              {layoutLayers.map((layer) => (
                <LayoutLayer
                  key={layer}
                  layer={layer}
                  element={template.elements[layer]}
                  selected={selectedLayer === layer}
                  sampleUrl={sampleUrl}
                  onPointerDown={(event) => startDrag(event, layer, "move")}
                  onResizePointerDown={(event) => startDrag(event, layer, "resize")}
                />
              ))}
            </div>
          </div>
        </main>

        <aside className="layoutProps">
          <h3>{layerLabel(selectedLayer)}</h3>
          <p>默认使用随包 Noto 中文字体。旧模板字体不可用时，中文内容回退到 Noto。</p>
          <div className="layoutLayerActions">
            <button type="button" className="secondaryAction" onClick={() => updateElement(selectedLayer, { visible: element.visible === false })}>
              {element.visible === false ? "恢复图层" : "删除图层"}
            </button>
          </div>
          <div className="layoutFieldGrid">
            <NumberField label="X" value={element.x} onChange={(x) => updateElement(selectedLayer, { x })} />
            <NumberField label="Y" value={element.y} onChange={(y) => updateElement(selectedLayer, { y })} />
            <NumberField label="宽度" value={element.width} onChange={(width) => updateElement(selectedLayer, { width })} />
            <NumberField label="高度" value={element.height} onChange={(height) => updateElement(selectedLayer, { height })} />
            {selectedLayer === "photo" ? (
              <>
                <NumberField label="圆角" value={element.radius || 0} onChange={(radius) => updateElement(selectedLayer, { radius })} />
                <label>
                  填充
                  <select value={element.fit || "cover"} onChange={(event) => updateElement(selectedLayer, { fit: event.target.value as "cover" | "contain" })}>
                    <option value="cover">铺满裁切</option>
                    <option value="contain">完整显示</option>
                  </select>
                </label>
              </>
            ) : (
              <>
                <NumberField label="字号" value={element.fontSize || 16} onChange={(fontSize) => updateElement(selectedLayer, { fontSize })} />
                <label>
                  字体
                  <select value={element.fontFamily || fontOptions[0].value} onChange={(event) => updateElement(selectedLayer, { fontFamily: event.target.value })}>
                    {fontOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  对齐
                  <select value={element.align || "left"} onChange={(event) => updateElement(selectedLayer, { align: event.target.value as "left" | "center" | "right" })}>
                    <option value="left">左对齐</option>
                    <option value="center">居中</option>
                    <option value="right">右对齐</option>
                  </select>
                </label>
                <label>
                  颜色
                  <input type="color" value={element.color || "#171b18"} onChange={(event) => updateElement(selectedLayer, { color: event.target.value })} />
                </label>
              </>
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}

function LayoutLayer({
  layer,
  element,
  selected,
  sampleUrl,
  onPointerDown,
  onResizePointerDown,
}: {
  layer: LayoutElementKey;
  element: LayoutElement;
  selected: boolean;
  sampleUrl: string;
  onPointerDown: (event: ReactPointerEvent) => void;
  onResizePointerDown: (event: ReactPointerEvent) => void;
}) {
  if (element.visible === false) return null;
  const style: CSSProperties = {
    left: element.x,
    top: element.y,
    width: element.width,
    height: element.height,
    fontSize: element.fontSize,
    fontFamily: element.fontFamily,
    color: element.color,
    textAlign: element.align,
    borderRadius: layer === "photo" ? element.radius : undefined,
  };
  return (
    <div className={`layoutLayer ${selected ? "selected" : ""} ${layer === "photo" ? "photo" : "text"}`} style={style} onPointerDown={onPointerDown}>
      {layer === "photo" ? <img src={sampleUrl} alt="" style={{ objectFit: element.fit || "cover" }} /> : previewText(layer)}
      <i className="layoutHandle" onPointerDown={onResizePointerDown} />
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label>
      {label}
      <input type="number" value={Math.round(value || 0)} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}


function ScoreBar({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="scoreBar">
      <span>{label}</span>
      <div>
        <i className={className} style={{ width: `${value}%` }} />
      </div>
      <b>{value.toFixed(1)}</b>
    </div>
  );
}

function toDraft(config: ApiConfig): ConfigDraft {
  return {
    imageDir: config.imageDir,
    providerBaseUrl: config.providerBaseUrl,
    apiKeyEnvName: config.apiKeyEnvName,
    model: config.model,
    excludeScreenshots: config.excludeScreenshots,
    maxImagesPerRun: config.maxImagesPerRun,
    maxConcurrentImages: config.maxConcurrentImages,
    dataDir: config.dataDir,
    databaseFile: config.databaseFile,
    renderFrameMode: config.renderFrameMode,
    renderWidth: config.renderWidth,
    renderHeight: config.renderHeight,
    footerHeight: config.footerHeight,
    wallpaperWidth: config.wallpaperWidth,
    wallpaperHeight: config.wallpaperHeight,
    wallpaperAutoIntervalHours: config.wallpaperAutoIntervalHours,
    wallpaperCollection: config.wallpaperCollection,
    layoutTemplates: config.layoutTemplates,
    promptVersion: config.promptVersion,
    scoringPrompt: config.scoringPrompt,
    sideCaptionPrompt: config.sideCaptionPrompt,
    modelOptionsText: config.modelOptions.join("\n"),
    excludeNamePatternsText: config.excludeNamePatterns.join("\n"),
  };
}

function buildConfigPayload(draftConfig: ConfigDraft) {
  return {
    imageDir: draftConfig.imageDir,
    providerBaseUrl: draftConfig.providerBaseUrl,
    apiKeyEnvName: draftConfig.apiKeyEnvName,
    model: draftConfig.model,
    modelOptions: splitLines(draftConfig.modelOptionsText, ["qwen3-vl:8b"]),
    excludeScreenshots: draftConfig.excludeScreenshots,
    excludeNamePatterns: splitLines(draftConfig.excludeNamePatternsText, ["screenshot"]),
    maxImagesPerRun: Number(draftConfig.maxImagesPerRun),
    maxConcurrentImages: Number(draftConfig.maxConcurrentImages),
    dataDir: draftConfig.dataDir,
    databaseFile: draftConfig.databaseFile,
    renderFrameMode: draftConfig.renderFrameMode,
    renderWidth: Number(draftConfig.renderWidth),
    renderHeight: Number(draftConfig.renderHeight),
    footerHeight: Number(draftConfig.footerHeight),
    wallpaperWidth: Number(draftConfig.wallpaperWidth),
    wallpaperHeight: Number(draftConfig.wallpaperHeight),
    wallpaperAutoIntervalHours: Number(draftConfig.wallpaperAutoIntervalHours),
    wallpaperCollection: draftConfig.wallpaperCollection,
    layoutTemplates: draftConfig.layoutTemplates,
    promptVersion: draftConfig.promptVersion,
    scoringPrompt: draftConfig.scoringPrompt,
    sideCaptionPrompt: draftConfig.sideCaptionPrompt,
  };
}

function splitLines(text: string, fallback: string[]): string[] {
  const items = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return items.length ? Array.from(new Set(items)) : fallback;
}

function formatToken(value: number): string {
  if (!value) return "--";
  return value >= 10000 ? `${(value / 10000).toFixed(1)}万` : String(value);
}


function sourceStatusLabel(status: SourceStatus): string {
  if (status === "pending") return "未处理";
  if (status === "processed") return "已处理";
  if (status === "skipped") return "已跳过";
  if (status === "failed") return "失败";
  if (status === "processing") return "处理中";
  return "全部";
}

function formatSourceMeta(source: SourcePhoto): string {
  const size = source.width && source.height ? `${source.width}x${source.height}` : "尺寸未知";
  const date = source.capturedDate || "日期未知";
  return `${date} · ${size}`;
}

function buildLayoutSampleUrls(sources: SourcePhoto[], items: GalleryImage[]): string[] {
  const urls = [...sources.map((source) => source.sourceUrl), ...items.map((item) => item.sourceUrl)].filter(Boolean);
  return Array.from(new Set(urls)).slice(0, 3);
}

function snap(value: number, target: number): number {
  return Math.abs(value - target) < 8 ? target : value;
}

function constrainLayoutElement(element: LayoutElement, template: LayoutTemplate): LayoutElement {
  const x = Math.max(0, Math.min(template.width - 1, Math.round(Number(element.x) || 0)));
  const y = Math.max(0, Math.min(template.height - 1, Math.round(Number(element.y) || 0)));
  const width = Math.max(1, Math.min(template.width - x, Math.round(Number(element.width) || 1)));
  const height = Math.max(1, Math.min(template.height - y, Math.round(Number(element.height) || 1)));
  return { ...element, x, y, width, height };
}

function frameLabel(frame: FrameKind): string {
  if (frame === "landscape") return "横图模板";
  if (frame === "square") return "方图模板";
  return "竖图模板";
}

function layerLabel(layer: LayoutElementKey): string {
  if (layer === "photo") return "照片区域";
  if (layer === "caption") return "主短句";
  if (layer === "date") return "日期";
  if (layer === "place") return "地点";
  return "回忆度";
}

function previewText(layer: LayoutElementKey): string {
  if (layer === "caption") return "不用管热量，先尝尝这口焦香再说。";
  if (layer === "date") return "2026.06.14";
  if (layer === "place") return "重庆";
  if (layer === "score") return "回忆度 78";
  return "";
}


async function postJson(url: string) {
  const response = await fetch(url, { method: "POST" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "请求失败。");
  return data;
}
