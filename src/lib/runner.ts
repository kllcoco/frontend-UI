/* Run code blocks: Python in a Pyodide worker; JavaScript in an opaque-origin sandboxed iframe
   (no access to this page, storage or cookies); HTML/SVG rendered in the same kind of sandbox. */
export type RunEvent =
  | { type: "status"; text: string }
  | { type: "stdout" | "stderr"; text: string }
  | { type: "done"; value?: string; images?: string[]; ms: number }
  | { type: "error"; text: string; ms?: number };

const PY = new Set(["python", "py", "python3"]);
const JS = new Set(["javascript", "js", "mjs"]);
const HTML = new Set(["html", "svg", "xml"]);
export const runnable = (lang: string) => PY.has(lang) || JS.has(lang) || HTML.has(lang);
export const rendersHtml = (lang: string) => HTML.has(lang);

let python: Worker | null = null;
let stopPython: (() => void) | null = null;
function pythonWorker(): Worker {
  python ??= new Worker(new URL("./python.worker.ts", import.meta.url), { type: "module" });
  return python;
}

/** Starts a run; returns a stop function. */
export function runCode(lang: string, code: string, onEvent: (e: RunEvent) => void): () => void {
  if (PY.has(lang)) {
    stopPython?.(); // one interpreter: a new run replaces the current one
    const worker = pythonWorker();
    let finished = false;
    worker.onmessage = (event: MessageEvent<RunEvent>) => {
      if (finished) return;
      if (event.data.type === "done" || event.data.type === "error") finished = true;
      onEvent(event.data);
    };
    worker.onerror = (event) => { finished = true; onEvent({ type: "error", text: event.message || "Python runtime failed to start" }); };
    worker.postMessage({ code, base: new URL("pyodide/", document.baseURI).href });
    // Stopping kills the interpreter; the next run starts a fresh one.
    const stop = () => { if (!finished) { finished = true; worker.terminate(); python = null; onEvent({ type: "error", text: "stopped" }); } };
    stopPython = stop;
    return stop;
  }
  if (JS.has(lang)) {
    const id = Math.random().toString(36).slice(2);
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.style.display = "none";
    const started = performance.now();
    let finished = false;
    const finish = (e: RunEvent) => { if (finished) return; finished = true; window.removeEventListener("message", onMessage); window.clearTimeout(timer); frame.remove(); onEvent(e); };
    const onMessage = (event: MessageEvent) => {
      const d = event.data as { ciroRun?: string; type?: string; text?: string };
      if (event.source !== frame.contentWindow || d?.ciroRun !== id) return;
      if (d.type === "end") finish({ type: "done", ms: Math.round(performance.now() - started) });
      else if (d.type === "error") finish({ type: "error", text: String(d.text), ms: Math.round(performance.now() - started) });
      else onEvent({ type: d.type === "stderr" ? "stderr" : "stdout", text: String(d.text) });
    };
    window.addEventListener("message", onMessage);
    const timer = window.setTimeout(() => finish({ type: "error", text: "timeout" }), 15_000);
    const harness = `<script>(()=>{const id=${JSON.stringify(id)};const send=(type,text)=>parent.postMessage({ciroRun:id,type,text},"*");
const fmt=a=>a.map(v=>{if(typeof v==="string")return v;try{return JSON.stringify(v,null,2)}catch{return String(v)}}).join(" ");
console.log=console.info=console.debug=(...a)=>send("stdout",fmt(a)+"\\n");console.warn=console.error=(...a)=>send("stderr",fmt(a)+"\\n");
window.onerror=(m)=>send("error",String(m));window.onunhandledrejection=(e)=>send("error",String(e.reason));
Promise.resolve().then(async()=>{${"\n"}${code.replace(/<\/script/gi, "<\\/script")}${"\n"}}).then(()=>setTimeout(()=>send("end"),0),e=>send("error",e&&e.stack||String(e)));})()<\/script>`;
    frame.srcdoc = harness;
    document.body.appendChild(frame);
    return () => finish({ type: "error", text: "stopped" });
  }
  onEvent({ type: "done", ms: 0 });
  return () => undefined;
}
