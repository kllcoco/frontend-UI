import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./cinematic.css";
import "./settings.css";
import "./white.css";
import "./workbench.css";
import "./workbench-entry.css";
import "./commercial.css";
import "./account.css";
// Shared Studio styles were previously missing from the production entrypoint.
import "./studio.css";
import "./ui-foundation.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Install only in production: no service worker intercepts developer HTTP or API tests.
if(import.meta.env.PROD && "serviceWorker" in navigator){
  window.addEventListener("load",()=>{void navigator.serviceWorker.register("/sw.js").catch(()=>{});});
}
