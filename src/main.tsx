import "./lib/polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SharedView from "./components/SharedView";
import ViewBoundary from "./components/ViewBoundary";
import "./lib/desktop";
import QuickAsk from "./components/QuickAsk";
import DesktopPet from "./pet/DesktopPet";
import "./pet/pet.css";
import { bootMobile, isMobileShell } from "./lib/mobile";
import "./styles.css";
import "./cinematic.css";
import "./settings.css";
import "./white.css";
import "./workbench.css";
import "./workbench-entry.css";
import "./commercial.css";
import "./account.css";
import "./studio.css";
import "katex/dist/katex.min.css";
import "./shell.css";
import "./tool-pages.css";
import "./crew.css";

bootMobile();
if (window.ciroDesktop) document.documentElement.dataset.desktop = window.ciroDesktop.platform;

const quick = new URLSearchParams(window.location.search).get("quick") === "1";
const pet = new URLSearchParams(window.location.search).get("pet") === "1";
const shareMatch = /^\/share\/([A-Za-z0-9_-]{16,40})\/?$/.exec(window.location.pathname);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Last line of defence: never a blank white page. */}
    <ViewBoundary t={(text) => text} onHome={() => window.location.reload()}>
      {shareMatch ? <SharedView id={shareMatch[1]} /> : pet ? <DesktopPet /> : quick ? <QuickAsk /> : <App />}
    </ViewBoundary>
  </React.StrictMode>
);

// Launch: once React has painted its first frame, fade the boot logo (index.html) into the app.
requestAnimationFrame(() => requestAnimationFrame(() => {
  document.documentElement.classList.add("ciro-ready");
  window.setTimeout(() => document.getElementById("ciro-boot")?.remove(), 600);
}));

// Install only in production: no service worker intercepts developer HTTP or API tests.
if(import.meta.env.PROD && "serviceWorker" in navigator && !isMobileShell() && !pet){
  window.addEventListener("load",()=>{void navigator.serviceWorker.register("/sw.js").catch(()=>{});});
}
