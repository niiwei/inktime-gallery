import { ArrowLeft, CheckSquare, Download, Home, Images, RefreshCw, RotateCcw, Settings2, Shuffle, Sparkles, Square, StopCircle, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, CSSProperties, FormEvent, PointerEvent as ReactPointerEvent } from "react";
import type { GalleryImage } from "../data/types";

type SortMode = "memory" | "newest";
type GalleryCollection = "sources" | "representative" | "all" | "curated";
type SourceStatus = "all" | "pending" | "processed" | "skipped" | "failed" | "processing";
type ViewMode = { type: "gallery" } | { type: "detail"; id: string };
type ProcessMode = "new" | "rerun";
type ProcessProgress = {
  id: string;
  mode: "idle" | "new" | "selected" | "rerun" | "rerender";
  status: "idle" | "running" | "done" | "error";
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
  { label: "宋体 / 衬线", value: "Songti SC, Noto Serif CJK SC, serif" },
  { label: "苹方 / 黑体", value: "PingFang SC, Hiragino Sans GB, sans-serif" },
  { label: "楷体", value: "Kaiti SC, STKaiti, serif" },
  { label: "Helvetica", value: "Helvetica Neue, Arial, sans-serif" },
];

export function App() {
  const [items, setItems] = useState<GalleryImage[]>([]);
  const [sources, setSources] = useState<SourcePhoto[]>([]);
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [draftConfig, setDraftConfig] = useState<ConfigDraft | null>(null);
  const [month, setMonth] = useState<number | "all">("all");
  const [day, setDay] = useState<number | "all">("all");
  const [sortMode, setSortMode] = useState<SortMode>("memory");
  const [collection, setCollection] = useState<GalleryCollection>("sources");
  const [sourceStatus, setSourceStatus] = useState<SourceStatus>("all");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [view, setView] = useState<ViewMode>({ type: "gallery" });
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isSettingWallpaper, setIsSettingWallpaper] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [layoutEditorOpen, setLayoutEditorOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<ProcessProgress | null>(null);
  const [stats, setStats] = useState<LibraryStats | null>(null);

  useEffect(() => {
    void fetchConfig();
    void refreshGallery();
    void refreshSources();
    void fetchStats();
  }, []);

  useEffect(() => {
    if (collection === "sources") {
      void refreshSources();
    } else {
      void refreshGallery();
    }
  }, [collection, sourceStatus]);

  useEffect(() => {
    if (!isProcessing) return;
    let cancelled = false;
    const pollProgress = async () => {
      try {
        const response = await fetch("/api/process/progress");
        if (!response.ok || cancelled) return;
        const nextProgress = (await response.json()) as ProcessProgress;
        setProgress(nextProgress);
        if (nextProgress.status === "done" || nextProgress.status === "error") {
          setIsProcessing(false);
          await refreshGallery();
          await refreshSources();
          await fetchStats();
        }
      } catch {
        // Progress is best-effort; the main request still owns final success/failure.
      }
    };
    void pollProgress();
    const timer = window.setInterval(() => void pollProgress(), 700);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isProcessing]);

  const filteredItems = useMemo(() => {
    const filtered = items.filter((item) => {
      const date = new Date(`${item.capturedDate}T00:00:00`);
      if (Number.isNaN(date.getTime())) return true;
      if (month !== "all" && date.getMonth() + 1 !== month) return false;
      if (day !== "all" && date.getDate() !== day) return false;
      return true;
    });

    return filtered.sort((a, b) => {
      if (sortMode === "newest") return b.processedAt.localeCompare(a.processedAt);
      return b.scores.memory - a.scores.memory;
    });
  }, [day, items, month, sortMode]);

  const filteredSources = useMemo(() => {
    return sources.filter((source) => {
      const date = new Date(`${source.capturedDate}T00:00:00`);
      if (Number.isNaN(date.getTime())) return true;
      if (month !== "all" && date.getMonth() + 1 !== month) return false;
      if (day !== "all" && date.getDate() !== day) return false;
      return true;
    });
  }, [day, month, sources]);

  const selected = view.type === "detail" ? items.find((item) => item.id === view.id) ?? null : null;
  const selectedIndex = selected ? filteredItems.findIndex((item) => item.id === selected.id) : -1;
  const previousItem = selectedIndex > 0 ? filteredItems[selectedIndex - 1] : null;
  const nextItem = selectedIndex >= 0 && selectedIndex < filteredItems.length - 1 ? filteredItems[selectedIndex + 1] : null;
  const databasePath = stats?.databasePath ?? (config ? `${config.dataDir}/${config.databaseFile}` : "--");
  const progressPercent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
  const visibleSourceIds = filteredSources.map((source) => source.id);
  const allVisibleSourcesSelected = visibleSourceIds.length > 0 && visibleSourceIds.every((id) => selectedSourceIds.includes(id));

  useEffect(() => {
    if (!selected || settingsOpen || layoutEditorOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "ArrowLeft" && previousItem) {
        event.preventDefault();
        setView({ type: "detail", id: previousItem.id });
      }
      if (event.key === "ArrowRight" && nextItem) {
        event.preventDefault();
        setView({ type: "detail", id: nextItem.id });
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        void toggleCurated(selected);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [layoutEditorOpen, nextItem, previousItem, selected, settingsOpen]);

  async function fetchConfig() {
    const response = await fetch("/api/config");
    if (!response.ok) return;
    const nextConfig = (await response.json()) as ApiConfig;
    setConfig(nextConfig);
    setDraftConfig(toDraft(nextConfig));
  }

  async function refreshGallery() {
    const response = await fetch(`/api/photos?collection=${collection}`);
    if (!response.ok) return;
    setItems((await response.json()) as GalleryImage[]);
  }

  async function refreshSources() {
    const response = await fetch(`/api/sources?status=${sourceStatus}`);
    if (!response.ok) return;
    const nextSources = (await response.json()) as SourcePhoto[];
    setSources(nextSources);
    setSelectedSourceIds((current) => current.filter((id) => nextSources.some((source) => source.id === id)));
  }

  async function fetchStats() {
    const response = await fetch("/api/library/stats");
    if (!response.ok) return;
    setStats((await response.json()) as LibraryStats);
  }

  async function scanSources() {
    setIsProcessing(true);
    setMessage("正在扫描图片目录...");
    try {
      const response = await fetch("/api/sources/scan", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "扫描失败。");
      setMessage(`扫描完成，共发现 ${data.total} 张图片。`);
      await refreshSources();
      await fetchStats();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "扫描失败。");
    } finally {
      setIsProcessing(false);
    }
  }

  async function processDirectory(mode: ProcessMode) {
    setIsProcessing(true);
    setProgress(null);
    setMessage(mode === "rerun" ? "正在按当前 Prompt 重跑已入库图片..." : "正在处理新图片...");
    try {
      const response = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "处理失败。");
      const prefix = mode === "rerun" ? "重跑完成" : "新增处理";
      const duplicateText = data.skippedDuplicates ? `，跳过完全重复 ${data.skippedDuplicates} 张` : "";
      const runText = data.runId ? `，runId：${data.runId}` : "";
      setMessage(`${prefix} ${data.processed} 张${duplicateText}${runText}。`);
      await refreshGallery();
      await refreshSources();
      await fetchConfig();
      await fetchStats();
    } catch (error) {
      const latestProgress = await fetchProgress();
      if (latestProgress?.status === "running") {
        setMessage("前端请求已断开，但后台仍在处理。你可以看进度继续等待，或点击停止。");
        return;
      }
      setMessage(error instanceof Error ? error.message : "处理失败。");
    } finally {
      const latestProgress = await fetchProgress();
      setIsProcessing(latestProgress?.status === "running");
    }
  }

  async function processSelectedSources() {
    if (!selectedSourceIds.length) return;
    setIsProcessing(true);
    setProgress(null);
    setMessage(`正在处理选中的 ${selectedSourceIds.length} 张图片...`);
    try {
      const response = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceIds: selectedSourceIds }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "处理失败。");
      setMessage(`选中图片处理完成 ${data.processed} 张${data.stopped ? "，任务已停止" : ""}。`);
      setSelectedSourceIds([]);
      await refreshSources();
      await refreshGallery();
      await fetchStats();
    } catch (error) {
      const latestProgress = await fetchProgress();
      if (latestProgress?.status === "running") {
        setMessage("前端请求已断开，但后台仍在处理。你可以看进度继续等待，或点击停止。");
        return;
      }
      setMessage(error instanceof Error ? error.message : "处理失败。");
    } finally {
      const latestProgress = await fetchProgress();
      setIsProcessing(latestProgress?.status === "running");
    }
  }

  async function stopProcessing() {
    try {
      await fetch("/api/process/stop", { method: "POST" });
      setMessage("正在停止当前处理，已完成的图片会保留。");
    } catch {
      setMessage("停止请求发送失败。");
    }
  }

  async function rerenderGallery() {
    setIsProcessing(true);
    setProgress(null);
    setMessage("正在用当前模板重新生成图片，不会调用模型...");
    try {
      const response = await fetch("/api/rerender", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "重新渲染失败。");
      setMessage(`已重新生成 ${data.rendered} 张图片，跳过 ${data.skipped} 张。`);
      await refreshGallery();
      await fetchStats();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重新渲染失败。");
    } finally {
      await fetchProgress();
      setIsProcessing(false);
    }
  }

  async function fetchProgress(): Promise<ProcessProgress | null> {
    try {
      const response = await fetch("/api/process/progress");
      if (!response.ok) return null;
      const nextProgress = (await response.json()) as ProcessProgress;
      setProgress(nextProgress);
      return nextProgress;
    } catch {
      setMessage("暂时连接不上本地服务，请稍后重试或重新打开 InkTime。");
      return null;
    }
  }

  async function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftConfig) return;
    setIsSavingConfig(true);
    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildConfigPayload(draftConfig)),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "保存配置失败。");
      const nextConfig = data as ApiConfig;
      setConfig(nextConfig);
      setDraftConfig(toDraft(nextConfig));
      setSettingsOpen(false);
      setMessage("配置已保存，下一次处理会使用新的设置。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存配置失败。");
    } finally {
      setIsSavingConfig(false);
    }
  }

  async function saveLayoutAndRerender(layoutTemplates: LayoutTemplates) {
    if (!draftConfig || isProcessing) return;
    setIsSavingConfig(true);
    setIsProcessing(true);
    setProgress(null);
    setMessage("正在保存布局并重新生成图片...");
    const nextDraft = { ...draftConfig, layoutTemplates };
    try {
      const configResponse = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildConfigPayload(nextDraft)),
      });
      const nextConfig = (await configResponse.json()) as ApiConfig | { error?: string };
      if (!configResponse.ok) throw new Error("error" in nextConfig ? nextConfig.error || "保存布局失败。" : "保存布局失败。");
      setConfig(nextConfig as ApiConfig);
      setDraftConfig(toDraft(nextConfig as ApiConfig));
      setLayoutEditorOpen(false);

      const rerenderResponse = await fetch("/api/rerender", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await rerenderResponse.json();
      if (!rerenderResponse.ok) throw new Error(data.error ?? "重新渲染失败。");
      setMessage(`布局已保存，并重新生成 ${data.rendered} 张图片，跳过 ${data.skipped} 张。`);
      await refreshGallery();
      await fetchStats();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存布局或重渲染失败。");
    } finally {
      await fetchProgress();
      setIsSavingConfig(false);
      setIsProcessing(false);
    }
  }

  async function clearLibrary() {
    if (!window.confirm("这会清空当前数据库记录和所有已生成的渲染图，原始照片不会删除。要继续吗？")) {
      return;
    }
    setIsProcessing(true);
    setMessage("正在清空数据库和渲染图...");
    try {
      const response = await fetch("/api/library/clear", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "清空失败。");
      setItems([]);
      setSources([]);
      setSelectedSourceIds([]);
      setView({ type: "gallery" });
      setMessage(`已清空 ${data.removedItems} 条记录，并删除 ${data.removedRenders} 张渲染图。`);
      await fetchStats();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "清空失败。");
    } finally {
      setIsProcessing(false);
    }
  }

  function randomDay() {
    if (!items.length) return;
    const sample = items[Math.floor(Math.random() * items.length)];
    const date = new Date(`${sample.capturedDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) return;
    setMonth(date.getMonth() + 1);
    setDay(date.getDate());
  }

  async function toggleCurated(item: GalleryImage) {
    const response = await fetch(`/api/photos/${item.id}/curated`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ curated: !item.isCurated }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "精选状态保存失败。");
      return;
    }
    setItems((current) => current.map((entry) => (entry.id === item.id ? data : entry)).filter((entry) => collection !== "curated" || entry.isCurated));
    await fetchStats();
    setMessage(data.isCurated ? "已加入精选。" : "已移出精选。");
  }

  async function setWallpaperNow() {
    setIsSettingWallpaper(true);
    setMessage("正在随机设置 Mac 壁纸...");
    try {
      const data = await postJson("/api/wallpaper/random");
      setMessage(`已设置壁纸：${data.fileName}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "壁纸设置失败。");
    } finally {
      setIsSettingWallpaper(false);
    }
  }

  function updateDraft(field: keyof ConfigDraft) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setDraftConfig((current) => (current ? { ...current, [field]: event.target.value } : current));
    };
  }

  function updateDraftBoolean(field: "excludeScreenshots") {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setDraftConfig((current) => (current ? { ...current, [field]: event.target.checked } : current));
    };
  }

  function toggleSourceSelection(id: string) {
    setSelectedSourceIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function toggleVisibleSources() {
    setSelectedSourceIds((current) => {
      if (allVisibleSourcesSelected) return current.filter((id) => !visibleSourceIds.includes(id));
      return Array.from(new Set([...current, ...visibleSourceIds]));
    });
  }

  if (selected) {
    return (
      <DetailView
        item={selected}
        currentIndex={selectedIndex}
        total={filteredItems.length}
        hasPrevious={Boolean(previousItem)}
        hasNext={Boolean(nextItem)}
        onBack={() => setView({ type: "gallery" })}
        onPrevious={() => previousItem && setView({ type: "detail", id: previousItem.id })}
        onNext={() => nextItem && setView({ type: "detail", id: nextItem.id })}
        onToggleCurated={() => void toggleCurated(selected)}
      />
    );
  }

  return (
    <main className="appFrame">
      <section className="appShell">
        <aside className="sidebar">
          <div className="brandBlock">
            <span className="appMark" aria-hidden="true" />
            <div>
              <h1>InkTime</h1>
              <p>照片记忆与壁纸</p>
            </div>
          </div>

          <nav className="libraryNav" aria-label="图库">
            <button type="button" className={collection === "sources" ? "navItem active" : "navItem"} onClick={() => setCollection("sources")}>
              <span>全部图片</span>
              <b>{stats?.original ?? 0}</b>
            </button>
            <button type="button" className={collection === "representative" ? "navItem active" : "navItem"} onClick={() => setCollection("representative")}>
              <span>代表照片</span>
              <b>{stats?.representatives ?? 0}</b>
            </button>
            <button type="button" className={collection === "all" ? "navItem active" : "navItem"} onClick={() => setCollection("all")}>
              <span>AI 全部</span>
              <b>{stats?.processed ?? 0}</b>
            </button>
            <button type="button" className={collection === "curated" ? "navItem active" : "navItem"} onClick={() => setCollection("curated")}>
              <span>精选</span>
              <b>{stats?.curated ?? 0}</b>
            </button>
          </nav>

          <div className="sidebarStats">
            <div>
              <span>未处理</span>
              <strong>{stats?.pending ?? "--"}</strong>
            </div>
            <div>
              <span>已跳过</span>
              <strong>{stats?.skipped ?? "--"}</strong>
            </div>
            <div>
              <span>失败</span>
              <strong>{stats?.failed ?? "--"}</strong>
            </div>
          </div>

          <div className="sidebarMeta">
            <span>{config?.model ?? "--"}</span>
            <span>{config?.promptVersion ?? "--"}</span>
            <span title={databasePath}>{databasePath}</span>
          </div>

          <button type="button" className="settingsToggle" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={16} /> 设置
          </button>
        </aside>

        <section className="workspace">
          <header className="topBar">
            <div className="titleBlock">
              <h2>{collectionTitle(collection)}</h2>
              <p title={config?.imageDir ?? ""}>{config?.imageDir ?? "还没有设置图片目录"}</p>
            </div>
            <div className="actionCluster">
              {collection === "sources" ? (
                <>
                  <button type="button" className="secondaryAction" onClick={() => void scanSources()} disabled={isProcessing}>
                    <Images size={15} /> 扫描目录
                  </button>
                  <button type="button" className="primaryAction" onClick={() => void processSelectedSources()} disabled={isProcessing || !selectedSourceIds.length}>
                    <RefreshCw size={15} /> 处理选中
                  </button>
                  {isProcessing ? (
                    <button type="button" className="dangerAction" onClick={() => void stopProcessing()}>
                      <StopCircle size={15} /> 停止
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  <button type="button" className="secondaryAction" onClick={() => void setWallpaperNow()} disabled={!items.length || isSettingWallpaper}>
                    <Sparkles size={15} /> {isSettingWallpaper ? "设置中" : "随机壁纸"}
                  </button>
                  <button type="button" className="primaryAction" onClick={() => void processDirectory("new")} disabled={isProcessing}>
                    <RefreshCw size={15} /> {isProcessing ? "处理中" : "处理新图"}
                  </button>
                  {isProcessing ? (
                    <button type="button" className="dangerAction" onClick={() => void stopProcessing()}>
                      <StopCircle size={15} /> 停止
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </header>

          <section className="filterBar" aria-label="筛选与操作">
            <label>
              月份
              <select value={month} onChange={(event) => setMonth(event.target.value === "all" ? "all" : Number(event.target.value))}>
                <option value="all">全部</option>
                {monthOptions.map((value) => (
                  <option key={value} value={value}>
                    {value} 月
                  </option>
                ))}
              </select>
            </label>
            <label>
              日期
              <select value={day} onChange={(event) => setDay(event.target.value === "all" ? "all" : Number(event.target.value))}>
                <option value="all">全部</option>
                {dayOptions.map((value) => (
                  <option key={value} value={value}>
                    {value} 日
                  </option>
                ))}
              </select>
            </label>
            <label>
              {collection === "sources" ? "状态" : "排序"}
              <select
                value={collection === "sources" ? sourceStatus : sortMode}
                onChange={(event) => {
                  if (collection === "sources") {
                    setSourceStatus(event.target.value as SourceStatus);
                  } else {
                    setSortMode(event.target.value as SortMode);
                  }
                }}
              >
                {collection === "sources" ? (
                  <>
                    <option value="all">全部状态</option>
                    <option value="pending">未处理</option>
                    <option value="processed">已处理</option>
                    <option value="skipped">已跳过</option>
                    <option value="failed">失败</option>
                    <option value="processing">处理中</option>
                  </>
                ) : (
                  <>
                    <option value="memory">按回忆度</option>
                    <option value="newest">按处理时间</option>
                  </>
                )}
              </select>
            </label>
            <div className="filterActions">
              <button type="button" onClick={randomDay}>
                <Shuffle size={15} /> 随机一天
              </button>
              <button
                type="button"
                onClick={() => {
                  setMonth("all");
                  setDay("all");
                }}
              >
                <Home size={15} /> 全部日期
              </button>
              <button type="button" onClick={() => void rerenderGallery()} disabled={isProcessing || !items.length}>
                <Sparkles size={15} /> 重渲染
              </button>
              <button type="button" onClick={() => void processDirectory("rerun")} disabled={isProcessing || !items.length || collection === "sources"}>
                <RotateCcw size={15} /> 重跑分析
              </button>
            </div>
          </section>

          <section className="summaryStrip">
            <span>
              当前显示 <strong>{collection === "sources" ? filteredSources.length : filteredItems.length}</strong> 张
            </span>
            <span>
              {collection === "sources" ? "已选择" : "本库共"} <strong>{collection === "sources" ? selectedSourceIds.length : items.length}</strong> 张
            </span>
            {collection === "sources" ? <span>已处理 <strong>{stats?.processed ?? 0}</strong> 张</span> : null}
            <span>{config?.apiKeyEnvName ? `API Key ${config?.apiKeyConfigured ? "已读取" : "未读取"}` : "本地模型模式"}</span>
          </section>

          {message ? <p className="statusLine">{message}</p> : null}
          {progress && progress.status !== "idle" ? (
            <section className="progressPanel" aria-live="polite">
              <div className="progressHeader">
                <strong>{progress.message || (isProcessing ? "正在处理..." : "处理状态")}</strong>
                <div className="progressHeaderActions">
                  <span>{progress.total ? `${progress.done}/${progress.total}` : progress.status === "running" ? "准备中" : "完成"}</span>
                  {progress.status === "running" ? (
                    <button type="button" className="dangerAction compact" onClick={() => void stopProcessing()}>
                      <StopCircle size={14} /> 停止
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="progressTrack">
                <i style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="progressMeta">
                <span>{progress.currentFile || " "}</span>
                <span>
                  成功 {progress.succeeded} / 失败 {progress.failed}
                  {progress.skippedDuplicates ? ` / 重复 ${progress.skippedDuplicates}` : ""}
                  {progress.tokenTotal ? ` / Token ${formatToken(progress.tokenTotal)}` : ""}
                </span>
              </div>
              {progress.aguiEvents?.length ? (
                <div className="aguiPanel">
                  <div className="aguiTitle">AGUI</div>
                  {progress.aguiEvents.slice(-8).map((event) => (
                    <div className={`aguiEvent ${event.kind}`} key={event.id}>
                      <span>{aguiKindLabel(event.kind)}</span>
                      <p>{event.text}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {collection === "sources" ? (
            filteredSources.length ? (
              <section className="sourceList">
                <div className="sourceToolbar">
                  <button type="button" onClick={toggleVisibleSources}>
                    {allVisibleSourcesSelected ? <CheckSquare size={15} /> : <Square size={15} />} {allVisibleSourcesSelected ? "取消本页" : "选择本页"}
                  </button>
                  <button type="button" onClick={() => setSelectedSourceIds([])} disabled={!selectedSourceIds.length}>
                    <X size={15} /> 清空选择
                  </button>
                </div>
                {filteredSources.map((source) => (
                  <article className={selectedSourceIds.includes(source.id) ? "sourceRow selected" : "sourceRow"} key={source.id}>
                    <button type="button" className="sourceCheck" onClick={() => toggleSourceSelection(source.id)} aria-label={`选择 ${source.fileName}`}>
                      {selectedSourceIds.includes(source.id) ? <CheckSquare size={18} /> : <Square size={18} />}
                    </button>
                    <img src={source.sourceUrl} alt={source.fileName} />
                    <div className="sourceInfo">
                      <strong>{source.fileName}</strong>
                      <span title={source.sourcePath}>{source.sourcePath}</span>
                      <span>{source.caption || source.skipReason || formatSourceMeta(source)}</span>
                    </div>
                    <div className="sourceState">
                      <b className={`statusPill ${source.status}`}>{sourceStatusLabel(source.status)}</b>
                      <span>{source.skipReason || (source.memoryScore !== null ? `回忆度 ${source.memoryScore.toFixed(1)}` : "等待处理")}</span>
                    </div>
                  </article>
                ))}
              </section>
            ) : (
              <section className="emptyPanel">
                <h2>还没有全量图片清单</h2>
                <p>先扫描目录，InkTime 会把文件夹里的图片写入本地台账，再显示处理状态和跳过原因。</p>
              </section>
            )
          ) : filteredItems.length ? (
            <section className="photoGrid">
              {filteredItems.map((item) => (
                <button className="photoCard" type="button" key={item.id} onClick={() => setView({ type: "detail", id: item.id })}>
                  <div className="photoThumb">
                    <img src={item.sourceUrl} alt={item.fileName} />
                  </div>
                  <div className="photoMeta">
                    <strong>{item.sideCaption || item.caption}</strong>
                    <span>{item.tags.join("、") || "未分类"}</span>
                    <span>{item.similarGroupId ? (item.isRepresentative ? "连拍代表" : "连拍备选") : "单张照片"}</span>
                    <div className="cardFooter">
                      <b>{item.scores.memory.toFixed(1)}</b>
                      <span>Token {formatToken(item.tokenUsage?.total || 0)}</span>
                    </div>
                  </div>
                </button>
              ))}
            </section>
          ) : (
            <section className="emptyPanel">
              <h2>还没有可展示的图片</h2>
              <p>确认图片目录、模型和提示词后，点击“处理新图”开始建立照片库。</p>
            </section>
          )}
        </section>
      </section>

      {settingsOpen && draftConfig ? (
        <div className="settingsOverlay" onClick={() => setSettingsOpen(false)}>
          <aside className="settingsPanel" onClick={(event) => event.stopPropagation()}>
            <div className="settingsHeader">
              <div>
                <h2>运行设置</h2>
                <p>测试期建议每一版 Prompt 都填写清晰版本号，便于回看和比较。</p>
              </div>
              <button type="button" className="iconOnly" onClick={() => setSettingsOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <form className="settingsForm" onSubmit={(event) => void saveConfig(event)}>
              <label>
                图片目录
                <input value={draftConfig.imageDir} onChange={updateDraft("imageDir")} />
              </label>

              <div className="settingsRow">
                <label>
                  模型接口地址
                  <input value={draftConfig.providerBaseUrl} onChange={updateDraft("providerBaseUrl")} />
                </label>
                <label>
                  API Key 环境变量名（可留空）
                  <input value={draftConfig.apiKeyEnvName} onChange={updateDraft("apiKeyEnvName")} />
                </label>
              </div>

              <div className="statusLine">
                {config?.apiKeyEnvName
                  ? `API Key 状态：${config?.apiKeyConfigured ? "已读取" : "未读取"}，从本地 .env.local / .env 中读取，不会显示在页面上。`
                  : "当前是本地模型模式，不需要 API Key。"}
              </div>

              <div className="settingsRow">
                <label>
                  模型
                  <select value={draftConfig.model} onChange={updateDraft("model")}>
                    {splitLines(draftConfig.modelOptionsText, ["qwen3-vl:8b"]).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Prompt 版本
                  <input value={draftConfig.promptVersion} onChange={updateDraft("promptVersion")} />
                </label>
              </div>

              <label>
                模型候选列表（每行一个）
                <textarea rows={5} value={draftConfig.modelOptionsText} onChange={updateDraft("modelOptionsText")} />
              </label>

              <label className="checkboxRow">
                <input type="checkbox" checked={draftConfig.excludeScreenshots} onChange={updateDraftBoolean("excludeScreenshots")} />
                <span>默认剔除屏幕截图</span>
              </label>

              <label>
                剔除文件名关键词（每行一个）
                <textarea rows={4} value={draftConfig.excludeNamePatternsText} onChange={updateDraft("excludeNamePatternsText")} />
              </label>

              <div className="settingsRow">
                <label>
                  每次处理上限
                  <input type="number" min="1" value={draftConfig.maxImagesPerRun} onChange={updateDraft("maxImagesPerRun")} />
                </label>
                <label>
                  并发处理数
                  <input type="number" min="1" max="6" value={draftConfig.maxConcurrentImages} onChange={updateDraft("maxConcurrentImages")} />
                </label>
                <label>
                  数据目录
                  <input value={draftConfig.dataDir} onChange={updateDraft("dataDir")} />
                </label>
                <label>
                  数据库文件名
                  <input value={draftConfig.databaseFile} onChange={updateDraft("databaseFile")} />
                </label>
              </div>
              <p className="settingsHint">每次处理上限表示本轮最多处理多少张照片；并发处理数表示同时处理多少张，数值越大越快，也越容易遇到接口限流。</p>

              <div className="layoutEditorCard">
                <div>
                  <strong>相框布局</strong>
                  <p>编辑横图、竖图、方图三套模板，拖拽图层后保存设置，再重渲染图库。</p>
                </div>
                <button type="button" className="secondaryAction" onClick={() => setLayoutEditorOpen(true)}>
                  打开布局编辑器
                </button>
              </div>

              <div className="settingsRow">
                <label>
                  短边宽度
                  <select value={draftConfig.renderFrameMode} onChange={updateDraft("renderFrameMode")}>
                    <option value="fixed">固定横竖模板</option>
                    <option value="adaptive">自适应相框</option>
                  </select>
                </label>
                <label>
                  短边宽度
                  <input type="number" min="1" value={draftConfig.renderWidth} onChange={updateDraft("renderWidth")} />
                </label>
                <label>
                  长边高度
                  <input type="number" min="1" value={draftConfig.renderHeight} onChange={updateDraft("renderHeight")} />
                </label>
                <label>
                  底部信息区高度
                  <input type="number" min="1" value={draftConfig.footerHeight} onChange={updateDraft("footerHeight")} />
                </label>
              </div>
              <div className="settingsRow">
                <label>
                  Mac 壁纸宽度
                  <input type="number" min="1" value={draftConfig.wallpaperWidth} onChange={updateDraft("wallpaperWidth")} />
                </label>
                <label>
                  Mac 壁纸高度
                  <input type="number" min="1" value={draftConfig.wallpaperHeight} onChange={updateDraft("wallpaperHeight")} />
                </label>
                <label>
                  自动换壁纸
                  <select value={draftConfig.wallpaperAutoIntervalHours} onChange={updateDraft("wallpaperAutoIntervalHours")}>
                    <option value={0}>关闭</option>
                    <option value={1}>每 1 小时</option>
                    <option value={2}>每 2 小时</option>
                    <option value={4}>每 4 小时</option>
                    <option value={8}>每 8 小时</option>
                    <option value={24}>每天一次</option>
                  </select>
                </label>
                <label>
                  壁纸来源
                  <select value={draftConfig.wallpaperCollection} onChange={updateDraft("wallpaperCollection")}>
                    <option value="representative">代表照片</option>
                    <option value="all">AI 全部照片</option>
                    <option value="curated">精选照片</option>
                  </select>
                </label>
              </div>
              <p className="settingsHint">自动换壁纸由 macOS LaunchAgent 按整点触发；InkTime 会根据这里的设置安装或卸载系统任务。</p>

              <label>
                回忆度提示词
                <textarea rows={16} value={draftConfig.scoringPrompt} onChange={updateDraft("scoringPrompt")} />
              </label>

              <label>
                底部短句提示词
                <textarea rows={10} value={draftConfig.sideCaptionPrompt} onChange={updateDraft("sideCaptionPrompt")} />
              </label>

              <div className="settingsActions">
                <button type="button" className="dangerAction" onClick={() => void clearLibrary()} disabled={isProcessing}>
                  清空数据库与渲染图
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraftConfig(config ? toDraft(config) : null);
                    setSettingsOpen(false);
                  }}
                >
                  取消
                </button>
                <button type="submit" className="primaryAction" disabled={isSavingConfig}>
                  {isSavingConfig ? "保存中" : "保存设置"}
                </button>
              </div>
              <div className="dangerPanel">
                <strong>数据管理</strong>
                <p>当前共 {items.length} 条记录。清空按钮会删除数据库里的全部条目和本地生成的渲染图，但不会动原始照片目录。</p>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
      {layoutEditorOpen && draftConfig ? (
        <LayoutEditor
          templates={draftConfig.layoutTemplates}
          sampleUrls={buildLayoutSampleUrls(sources, items)}
          onChange={(layoutTemplates) => setDraftConfig((current) => (current ? { ...current, layoutTemplates } : current))}
          onSave={(layoutTemplates) => void saveLayoutAndRerender(layoutTemplates)}
          onClose={() => setLayoutEditorOpen(false)}
        />
      ) : null}
    </main>
  );
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
            <button type="button" className="primaryAction" onClick={() => onSave(templates)}>
              保存布局并重渲染
            </button>
          </div>
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

function DetailView({
  item,
  currentIndex,
  total,
  hasPrevious,
  hasNext,
  onBack,
  onPrevious,
  onNext,
  onToggleCurated,
}: {
  item: GalleryImage;
  currentIndex: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onBack: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onToggleCurated: () => void;
}) {
  const [isSettingWallpaper, setIsSettingWallpaper] = useState(false);
  const [wallpaperMessage, setWallpaperMessage] = useState("");

  async function setThisWallpaper() {
    setIsSettingWallpaper(true);
    setWallpaperMessage("正在设置为 Mac 壁纸...");
    try {
      const data = await postJson(`/api/photos/${item.id}/wallpaper`);
      setWallpaperMessage(`已设置壁纸：${data.fileName}`);
    } catch (error) {
      setWallpaperMessage(error instanceof Error ? error.message : "壁纸设置失败。");
    } finally {
      setIsSettingWallpaper(false);
    }
  }

  return (
    <main className="appFrame">
      <section className="simPage">
        <div className="renderColumn">
          <img src={item.renderedUrl} alt={`${item.fileName} rendered`} />
        </div>
        <article className="insightPanel">
          <button className="backButton" type="button" onClick={onBack}>
            <ArrowLeft size={16} /> 返回
          </button>
          <button className="backButton" type="button" onClick={onPrevious} disabled={!hasPrevious}>
            ← 上一张
          </button>
          <button className="backButton" type="button" onClick={onNext} disabled={!hasNext}>
            下一张 →
          </button>
          <button className={`backButton curatedToggle ${item.isCurated ? "active" : ""}`} type="button" onClick={onToggleCurated} aria-pressed={item.isCurated}>
            <Sparkles size={16} /> {item.isCurated ? "已精选" : "加入精选"} <kbd>F</kbd>
          </button>
          <button className="backButton" type="button" onClick={() => void setThisWallpaper()} disabled={isSettingWallpaper || !item.wallpaperUrl}>
            <Sparkles size={16} /> {isSettingWallpaper ? "设置中" : "设为壁纸"}
          </button>
          <p className="shortcutHint">
            {total ? `${currentIndex + 1} / ${total}` : ""} · 使用 ← / → 切换照片，按 F 加入或取消精选
          </p>
          <h1>{item.sideCaption || item.caption}</h1>
          {wallpaperMessage ? <p className="statusLine">{wallpaperMessage}</p> : null}
          <div className="tagRow">
            {item.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          <p>{item.caption}</p>
          <ScoreBar label="回忆度" value={item.scores.memory} className="memory" />
          <div className="reasonBox">
            <strong>评分理由：</strong>
            {item.reason}
          </div>
          <div className="reasonBox">
            <strong>实验信息：</strong>
            {item.promptVersion || "-"} · {item.model || "-"} · {item.runId || "-"}
          </div>
          <div className="reasonBox">
            <strong>数据库信息：</strong>
            {item.similarGroupId ? (item.isRepresentative ? "连拍组代表" : "连拍组备选") : "单张照片"} · Token {formatToken(item.tokenUsage?.total || 0)}
          </div>
          <footer>
            <span>{item.sourcePath}</span>
            <a href={item.renderedUrl} download>
              <Download size={15} /> 下载渲染图
            </a>
            {item.wallpaperUrl ? (
              <a href={item.wallpaperUrl} download>
                <Download size={15} /> 下载 Mac 壁纸
              </a>
            ) : null}
          </footer>
        </article>
      </section>
    </main>
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

function collectionTitle(collection: GalleryCollection): string {
  if (collection === "sources") return "全部图片";
  if (collection === "all") return "AI 全部照片";
  if (collection === "curated") return "精选照片";
  return "代表照片";
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

function aguiKindLabel(kind: NonNullable<ProcessProgress["aguiEvents"]>[number]["kind"]): string {
  if (kind === "read") return "读取";
  if (kind === "compress") return "压缩";
  if (kind === "call") return "调用";
  if (kind === "output") return "输出";
  if (kind === "error") return "错误";
  return "提醒";
}

async function postJson(url: string) {
  const response = await fetch(url, { method: "POST" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "请求失败。");
  return data;
}
