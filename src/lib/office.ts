/* Text from Office files (read in the browser, nothing is uploaded): Word pages, Excel sheets, PowerPoint slides.
   Markers like "[第 3 页]" let the model cite where an answer came from. */
import { unzipSync, strFromU8 } from "fflate";

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
const texts = (xml: string, tag: string) => Array.from(xml.matchAll(new RegExp("<" + tag + "(?:\\s[^>]*)?>([^<]*)</" + tag + ">", "g")), (m) => decode(m[1]));

function open(buffer: ArrayBuffer): Record<string, Uint8Array> {
  try { return unzipSync(new Uint8Array(buffer)); }
  catch { throw new Error("文件已损坏，或不是 Office 文档"); }
}

/** Word: paragraphs, with "[第 N 页]" at each page break Word recorded (page numbers are approximate). */
export function docxText(buffer: ArrayBuffer): string {
  const files = open(buffer);
  const doc = files["word/document.xml"];
  if (!doc) throw new Error("不是有效的 Word 文档");
  const xml = strFromU8(doc);
  let page = 1;
  const out: string[] = ["[第 1 页]"];
  for (const p of xml.split(/<\/w:p>/)) {
    // A page break before this paragraph's text starts a new page.
    if (/<w:br [^>]*w:type="page"|<w:lastRenderedPageBreak\/>|<w:pageBreakBefore\/>/.test(p)) { page += 1; out.push("", "[第 " + page + " 页]"); }
    const line = texts(p.replace(/<w:tab\/>/g, "<w:t>\t</w:t>"), "w:t").join("");
    if (line.trim()) out.push(line);
  }
  return out.join("\n");
}

/** Excel: each sheet as rows of cell values, under "[工作表 名称]". */
export function xlsxText(buffer: ArrayBuffer, maxRows = 2000): string {
  const files = open(buffer);
  const shared = files["xl/sharedStrings.xml"] ? Array.from(strFromU8(files["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g), (m) => texts(m[1], "t").join("")) : [];
  const book = files["xl/workbook.xml"] ? strFromU8(files["xl/workbook.xml"]) : "";
  const names = Array.from(book.matchAll(/<sheet [^>]*name="([^"]*)"/g), (m) => decode(m[1]));
  const sheets = Object.keys(files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  if (!sheets.length) throw new Error("不是有效的 Excel 文件");
  const out: string[] = [];
  sheets.forEach((path, i) => {
    out.push((out.length ? "\n" : "") + "[工作表 " + (names[i] || "Sheet" + (i + 1)) + "]");
    const xml = strFromU8(files[path]);
    let rows = 0;
    for (const row of xml.matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      if (++rows > maxRows) { out.push("…"); break; }
      const cells: string[] = [];
      for (const c of row[2].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /r="([A-Z]+\d+)"/.exec(c[1])?.[1] || "";
        const type = /t="(\w+)"/.exec(c[1])?.[1];
        const v = /<v>([^<]*)<\/v>/.exec(c[2] || "")?.[1];
        const inline = texts(c[2] || "", "t").join("");
        const value = type === "s" && v !== undefined ? shared[Number(v)] ?? "" : type === "inlineStr" ? inline : v !== undefined ? decode(v) : "";
        if (value !== "") cells.push(ref + ": " + value);
      }
      if (cells.length) out.push("第 " + row[1] + " 行 | " + cells.join(" | "));
    }
  });
  return out.join("\n");
}

/** PowerPoint: text of each slide under "[第 N 张幻灯片]". */
export function pptxText(buffer: ArrayBuffer): string {
  const files = open(buffer);
  const slides = Object.keys(files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  if (!slides.length) throw new Error("不是有效的 PowerPoint 文件");
  return slides.map((path, i) => {
    const xml = strFromU8(files[path]);
    const paras = Array.from(xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g), (m) => texts(m[1], "a:t").join("")).filter((x) => x.trim());
    return "[第 " + (i + 1) + " 张幻灯片]\n" + paras.join("\n");
  }).join("\n\n");
}

/** Where an answer cites "第 N 页" / "第 N 张幻灯片" / "工作表 X": the matching section of the attached text. */
export type Citation = { file: string; label: string; text: string };
export function findCitations(answer: string, attachText: string): Citation[] {
  // Split the attachment text back into files ("附件：name" blocks) and sections.
  const blocks = attachText.split(/(?:^|\n\n)(?=(?:附件：|Attachment: |附件：))/).filter(Boolean);
  const files = blocks.map((b) => {
    const name = /^(?:附件：|Attachment: )(.+)/.exec(b)?.[1]?.trim() || "";
    const sections = new Map<string, string>();
    const parts = b.split(/\n(?=\[(?:第 \d+ (?:页|张幻灯片)|工作表 [^\]]+)\])/);
    for (const part of parts) {
      const m = /^\[((?:第 \d+ (?:页|张幻灯片))|(?:工作表 [^\]]+))\]\n?([\s\S]*)/.exec(part);
      if (m) sections.set(m[1], m[2].replace(/\n```\s*$/, "").trim());
    }
    return { name, sections };
  }).filter((f) => f.sections.size);
  if (!files.length) return [];
  const seen = new Set<string>(), out: Citation[] = [];
  // Chinese or English citations: 第 3 页 / page 3, 第 2 张幻灯片 / slide 2, 工作表 销售 / sheet Sales.
  for (const m of answer.matchAll(/第\s*(\d+)\s*(页|张幻灯片)|工作表\s*[「“"]?([^\s」”"，。,.；;）)\]】]+)|\b(page|slide)\s*(\d+)|\bsheet\s+["“]?([^\s"”,.;)\]]+)/gi)) {
    const label = m[1] ? "第 " + m[1] + " " + m[2] : m[3] ? "工作表 " + m[3] : m[5] ? "第 " + m[5] + " " + (m[4].toLowerCase() === "page" ? "页" : "张幻灯片") : "工作表 " + m[6];
    // Prefer a file named right before the citation, else the first file that has this section.
    const before = answer.slice(Math.max(0, m.index! - 60), m.index);
    const file = files.find((f) => f.sections.has(label) && before.includes(f.name)) || files.find((f) => f.sections.has(label));
    if (!file) continue;
    const key = file.name + "|" + label;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ file: file.name, label, text: file.sections.get(label)!.slice(0, 6000) });
    if (out.length >= 12) break;
  }
  return out;
}
