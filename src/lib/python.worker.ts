/// <reference lib="webworker" />
/* Runs Python with Pyodide off the main thread. stdout/stderr stream back; matplotlib figures are
   captured as PNG data URLs. One interpreter per worker; the host terminates the worker to stop a run. */
type PyodideLike = {
  setStdout: (o: { batched: (s: string) => void }) => void;
  setStderr: (o: { batched: (s: string) => void }) => void;
  loadPackagesFromImports: (code: string, o?: { messageCallback?: (m: string) => void }) => Promise<void>;
  runPythonAsync: (code: string) => Promise<unknown>;
  globals: { get: (name: string) => unknown };
};
let ready: Promise<PyodideLike> | null = null;
const post = (msg: Record<string, unknown>) => (self as unknown as Worker).postMessage(msg);

const FIGURE_HOOK = `
import sys, io, base64
def __ciro_figures():
    if "matplotlib" not in sys.modules: return []
    import matplotlib.pyplot as plt
    out = []
    for n in plt.get_fignums():
        buf = io.BytesIO(); plt.figure(n).savefig(buf, format="png", bbox_inches="tight", dpi=110)
        out.append("data:image/png;base64," + base64.b64encode(buf.getvalue()).decode())
    plt.close("all")
    return out
`;

function load(base: string): Promise<PyodideLike> {
  ready ??= (async () => {
    const mod = await import(/* @vite-ignore */ base + "pyodide.mjs") as { loadPyodide: (o: Record<string, unknown>) => Promise<PyodideLike> };
    const py = await mod.loadPyodide({ indexURL: base, lockFileURL: base + "pyodide-lock.json" });
    py.setStdout({ batched: (s) => post({ type: "stdout", text: s + "\n" }) });
    py.setStderr({ batched: (s) => post({ type: "stderr", text: s + "\n" }) });
    await py.runPythonAsync("import os\nos.environ['MPLBACKEND']='AGG'\n" + FIGURE_HOOK);
    return py;
  })();
  return ready;
}

self.onmessage = async (event: MessageEvent<{ code: string; base: string }>) => {
  const { code, base } = event.data;
  const started = performance.now();
  try {
    post({ type: "status", text: "loading" });
    const py = await load(base);
    await py.loadPackagesFromImports(code, { messageCallback: (m) => post({ type: "status", text: m }) });
    post({ type: "status", text: "running" });
    const result = await py.runPythonAsync(code);
    const figures = await py.runPythonAsync("__ciro_figures()") as { toJs: () => string[]; destroy?: () => void };
    const images = figures.toJs(); figures.destroy?.();
    const value = result === undefined || result === null ? "" : String(result);
    post({ type: "done", value, images, ms: Math.round(performance.now() - started) });
  } catch (error) {
    post({ type: "error", text: error instanceof Error ? error.message : String(error), ms: Math.round(performance.now() - started) });
  }
};
