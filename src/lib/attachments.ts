/* Composer attachments: text/code inline, PDF → extracted text, images → compressed data URLs.
   Full-size images live in IndexedDB (localStorage would overflow); chat history keeps thumbnails. */
import { newId } from "./storage";
import { docxText, pptxText, xlsxText } from "./office";

export type Attachment =
  | { id: string; kind: "text"; name: string; content: string; size: number }
  | { id: string; kind: "image"; name: string; dataUrl: string; thumb: string; size: number };

export const LIMITS = { files: 5, textBytes: 200_000, imageBytes: 20_000_000, pdfBytes: 25_000_000, pdfChars: 120_000 };
export const TEXT_EXT = /\.(txt|md|markdown|json|csv|ts|tsx|js|jsx|mjs|cjs|py|html|css|scss|xml|yaml|yml|toml|ini|sql|log|sh|ps1|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|vue|svelte)$/i;
export const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif)$/;
export const ACCEPT = ".txt,.md,.markdown,.json,.csv,.ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.html,.css,.scss,.xml,.yaml,.yml,.toml,.ini,.sql,.log,.sh,.ps1,.go,.rs,.java,.kt,.swift,.c,.cc,.cpp,.h,.hpp,.cs,.rb,.php,.vue,.svelte,.pdf,.docx,.xlsx,.pptx,image/png,image/jpeg,image/webp,image/gif";

export class AttachmentError extends Error {}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new AttachmentError("无法读取图片"));
    img.src = src;
  });
}
function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new AttachmentError("读取附件失败"));
    reader.readAsDataURL(file);
  });
}
async function resize(src: string, max: number, quality: number, keepPng: boolean): Promise<string> {
  const img = await loadImage(src);
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return keepPng ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", quality);
}

/** Small JPEG preview for chat history (full image stays in IndexedDB). */
export function makeThumb(dataUrl: string): Promise<string> { return resize(dataUrl, 320, 0.78, false); }

async function pdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  let total = 0;
  for (let i = 1; i <= doc.numPages && total < LIMITS.pdfChars; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+\n/g, "\n").trim();
    pages.push("[第 " + i + " 页]\n" + text);
    total += text.length;
  }
  const joined = pages.join("\n\n").slice(0, LIMITS.pdfChars);
  if (!joined.replace(/\[第 \d+ 页\]/g, "").trim()) throw new AttachmentError("PDF 中没有可提取的文字（可能是扫描件）");
  return joined;
}

export async function readAttachment(file: File): Promise<Attachment> {
  if (IMAGE_TYPES.test(file.type)) {
    if (file.size > LIMITS.imageBytes) throw new AttachmentError("图片不能超过 20 MB");
    const original = await readDataUrl(file);
    const png = file.type === "image/png" && file.size < 1_500_000;
    const dataUrl = file.type === "image/gif" ? original : await resize(original, 2048, 0.86, png);
    const thumb = await resize(original, 320, 0.78, false);
    return { id: newId(), kind: "image", name: file.name || "image.png", dataUrl, thumb, size: dataUrl.length };
  }
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    if (file.size > LIMITS.pdfBytes) throw new AttachmentError("PDF 不能超过 25 MB");
    const content = await pdfText(file);
    return { id: newId(), kind: "text", name: file.name, content, size: content.length };
  }
  const office = /\.(docx|xlsx|pptx)$/i.exec(file.name)?.[1].toLowerCase();
  if (office) {
    if (file.size > LIMITS.pdfBytes) throw new AttachmentError("文件不能超过 25 MB");
    let content: string;
    try {
      const buffer = await file.arrayBuffer();
      content = office === "docx" ? docxText(buffer) : office === "xlsx" ? xlsxText(buffer) : pptxText(buffer);
    } catch (e) { throw new AttachmentError(e instanceof Error ? e.message : "无法读取文件"); }
    if (!content.replace(/\[(第 \d+ (页|张幻灯片)|工作表 [^\]]+)\]/g, "").trim()) throw new AttachmentError("文件里没有可读取的文字");
    content = content.slice(0, LIMITS.pdfChars);
    return { id: newId(), kind: "text", name: file.name, content, size: content.length };
  }
  if (/\.(doc|xls|ppt)$/i.test(file.name)) throw new AttachmentError("旧版 Office 格式暂不支持，请另存为 .docx / .xlsx / .pptx 后再上传");
  if (!TEXT_EXT.test(file.name)) throw new AttachmentError("不支持的文件类型");
  if (file.size > LIMITS.textBytes) throw new AttachmentError("文本文件不能超过 200 KB");
  const content = await file.text();
  return { id: newId(), kind: "text", name: file.name, content, size: content.length };
}

/* ── IndexedDB store for full-size images ── */
const DB = "ciro-attachments";
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("images");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function putImage(id: string, dataUrl: string): Promise<void> {
  try {
    const store = (await db()).transaction("images", "readwrite").objectStore("images");
    await new Promise<void>((resolve, reject) => { const r = store.put(dataUrl, id); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); });
  } catch { /* storage unavailable: thumbnails still work */ }
}
export async function getImage(id: string): Promise<string | null> {
  try {
    const store = (await db()).transaction("images", "readonly").objectStore("images");
    return await new Promise((resolve) => { const r = store.get(id); r.onsuccess = () => resolve(typeof r.result === "string" ? r.result : null); r.onerror = () => resolve(null); });
  } catch { return null; }
}
/** Every stored full-size image (for backups). */
export async function allImages(): Promise<Record<string, string>> {
  try {
    const store = (await db()).transaction("images", "readonly").objectStore("images");
    return await new Promise((resolve) => {
      const out: Record<string, string> = {};
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) { resolve(out); return; }
        if (typeof cursor.value === "string") out[String(cursor.key)] = cursor.value;
        cursor.continue();
      };
      req.onerror = () => resolve(out);
    });
  } catch { return {}; }
}
