export type ImageOrientation = "landscape" | "portrait" | "square";

export type ImageMetrics = {
  width: number;
  height: number;
  orientation: ImageOrientation;
  contrast: number;
  saturation: number;
  brightness: number;
};

export type ImageScores = {
  memory: number;
};

export type GalleryImage = {
  id: string;
  sourceId?: string;
  runId?: string;
  promptVersion?: string;
  model?: string;
  fileName: string;
  fileHash?: string;
  perceptualHash?: string;
  sourcePath: string;
  sourceUrl: string;
  renderedUrl: string;
  wallpaperUrl?: string;
  scores: ImageScores;
  metrics?: ImageMetrics;
  caption: string;
  sideCaption?: string;
  reason: string;
  tags: string[];
  location?: string;
  capturedAt?: string;
  capturedDate: string;
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
    estimated: boolean;
  };
  similarGroupId?: string;
  isRepresentative?: boolean;
  isCurated?: boolean;
  processedAt: string;
};

export type RenderOptions = {
  width: number;
  height: number;
  footerHeight: number;
};
