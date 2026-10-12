import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// Ship the Pyodide core with the app (offline Python for code blocks). Optional packages such as numpy
// are not bundled: their lock entries point at the matching jsDelivr build and load on demand.
function stagePyodide() {
  const src = new URL("./node_modules/pyodide/", import.meta.url);
  const out = new URL("./public/pyodide/", import.meta.url);
  if (!existsSync(src)) return;
  const pyVersion = (JSON.parse(readFileSync(new URL("package.json", src), "utf8")) as { version: string }).version;
  mkdirSync(out, { recursive: true });
  for (const file of ["pyodide.mjs", "pyodide.asm.js", "pyodide.asm.wasm", "python_stdlib.zip"]) copyFileSync(new URL(file, src), new URL(file, out));
  const lock = JSON.parse(readFileSync(new URL("pyodide-lock.json", src), "utf8")) as { packages: Record<string, { file_name: string }> };
  const cdn = "https://cdn.jsdelivr.net/pyodide/v" + pyVersion + "/full/";
  Object.values(lock.packages).forEach((pkg) => { if (!/^https?:/.test(pkg.file_name)) pkg.file_name = cdn + pkg.file_name; });
  writeFileSync(new URL("pyodide-lock.json", out), JSON.stringify(lock));
}
stagePyodide();

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8787"
    }
  }
});
