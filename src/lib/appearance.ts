export type PresetId = "white" | "night" | "aurora" | "summit" | "city" | "minimal" | "custom";
export type BackgroundScope = "all" | "welcome";

export type AppearanceSettings = {
  preset: PresetId;
  scope: BackgroundScope;
  brightness: number;
  blur: number;
  overlay: number;
};

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  preset: "white",
  scope: "all",
  brightness: 100,
  blur: 0,
  overlay: 0
};

const APPEARANCE_KEY = "ciro.appearance.v1";
const IMAGE_STORE = "ciro.wallpaper";
const STORE_NAME = "wallpapers";
const CUSTOM_KEY = "custom";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const VALID_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

export const WALLPAPER_PRESETS: Array<{ id: Exclude<PresetId, "custom">; name: string; url: string }> = [
  { id: "white", name: "象牙白", url: "/backgrounds/white.svg" },
  { id: "night", name: "黑金星夜", url: "/backgrounds/night-lake.svg" },
  { id: "aurora", name: "金色星轨", url: "/backgrounds/aurora.svg" },
  { id: "summit", name: "暮金远山", url: "/backgrounds/summit.svg" },
  { id: "city", name: "黑金夜城", url: "/backgrounds/city.svg" },
  { id: "minimal", name: "曜石纯黑", url: "/backgrounds/minimal.svg" }
];

export function backgroundUrl(preset: PresetId, customUrl: string | null): string {
  if (preset === "custom" && customUrl) return customUrl;
  return WALLPAPER_PRESETS.find((item) => item.id === preset)?.url || WALLPAPER_PRESETS[0].url;
}

export function clampValue(value: number, low: number, high: number): number {
  return Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : low;
}

export function loadAppearance(): AppearanceSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(APPEARANCE_KEY) || "{}") as Partial<AppearanceSettings>;
    const validPresets: PresetId[] = ["white", "night", "aurora", "summit", "city", "minimal", "custom"];
    return {
      preset: validPresets.includes(saved.preset as PresetId) ? saved.preset as PresetId : "white",
      scope: saved.scope === "welcome" ? "welcome" : "all",
      brightness: clampValue(Number(saved.brightness ?? 100), 20, 120),
      blur: clampValue(Number(saved.blur ?? 0), 0, 24),
      overlay: clampValue(Number(saved.overlay ?? 0), 0, 85)
    };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function saveAppearance(settings: AppearanceSettings): void {
  try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(settings)); }
  catch { /* local storage can be unavailable */ }
}

function openWallpaperDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前浏览器不支持图片本地存储"));
      return;
    }
    const request = indexedDB.open(IMAGE_STORE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("无法访问浏览器图片存储"));
    request.onblocked = () => reject(new Error("背景图片存储正在被其他页面占用"));
  });
}

async function wallpaperTransaction(mode: IDBTransactionMode, task: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
  const database = await openWallpaperDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      let result: unknown;
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(new Error("背景图片存储失败，请检查浏览器空间"));
      transaction.onabort = () => reject(new Error("背景图片存储被中断"));
      const request = task(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(new Error("无法读取或保存背景图片"));
    });
  } finally {
    database.close();
  }
}

export async function loadCustomWallpaper(): Promise<Blob | null> {
  const value = await wallpaperTransaction("readonly", (store) => store.get(CUSTOM_KEY));
  return value instanceof Blob ? value : null;
}

export async function saveCustomWallpaper(file: File): Promise<void> {
  if (!VALID_MIME.has(file.type)) {
    throw new Error("仅支持 JPG、PNG、WebP 或 AVIF 图片");
  }
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error("图片不得超过 8 MB，且不能为空");
  }
  await wallpaperTransaction("readwrite", (store) => store.put(file, CUSTOM_KEY));
}

export async function removeCustomWallpaper(): Promise<void> {
  await wallpaperTransaction("readwrite", (store) => store.delete(CUSTOM_KEY));
}
