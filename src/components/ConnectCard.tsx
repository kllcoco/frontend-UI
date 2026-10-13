import { useState } from "react";
import { PlugZap, Server, Settings2 } from "lucide-react";
import { OFFICIAL_SERVER, connectServer, isMobileShell, isRemoteMobile, normalizeServer, savedServer } from "../lib/mobile";

/** Welcome-screen card shown until a model service is connected, with the next step for this platform. */
export default function ConnectCard({ t, onOpenModels }: { t: (s: string) => string; onOpenModels: () => void }) {
  const desktop = (window as unknown as { ciroDesktop?: { openConfig?: () => void } }).ciroDesktop;
  const phoneApp = isMobileShell() && !isRemoteMobile();
  const [server, setServer] = useState(() => savedServer() || "");
  const [error, setError] = useState("");
  const connect = () => {
    try { connectServer(normalizeServer(server)); }
    catch { setError(t("地址格式不正确，例如 https://ciro.example.com 或 http://192.168.1.10:8787")); }
  };
  return <div className="cx-connect" role="region" aria-label={t("连接模型")}>
    <div className="cx-connect-head"><PlugZap size={18}/><strong>{t("还差一步：连接模型")}</strong></div>
    {phoneApp ? <>
      {OFFICIAL_SERVER && <><p>{t("使用 Ciro 官方服务器：注册或登录后即可对话，聊天记录可在你的设备间同步。")}</p>
        <div className="cx-connect-row"><button type="button" onClick={() => connectServer(OFFICIAL_SERVER)}><Server size={16}/>{t("连接官方服务器")}</button></div>
        <small>{t("或者连接你自己的服务器：")}</small></>}
      {!OFFICIAL_SERVER && <p>{t("填写你的 Ciro 服务器地址（部署 Ciro 的网址），连接后就能正常对话。")}</p>}
      <form className="cx-connect-row" onSubmit={(e) => { e.preventDefault(); connect(); }}>
        <input value={server} onChange={(e) => { setServer(e.target.value); setError(""); }} inputMode="url" autoCapitalize="off" autoCorrect="off"
          placeholder="https://ciro.example.com" aria-label={t("Ciro 服务器地址")}/>
        <button type="submit" disabled={!server.trim()}><Server size={16}/>{t("连接")}</button>
      </form>
      {error && <p className="cx-connect-error" role="alert">{error}</p>}
      <small>{t("还没有服务器？可以在电脑上安装 Ciro 桌面版，或按发布页的部署教程搭建。")}</small>
    </> : desktop ? <>
      <p>{t("在配置文件里填写模型接口地址（CIRO_API_BASE_URL）、模型名和密钥，保存后重启 Ciro 即可。")}</p>
      <div className="cx-connect-row">
        {desktop.openConfig && <button type="button" onClick={() => desktop.openConfig!()}><Settings2 size={16}/>{t("打开模型配置")}</button>}
        <button type="button" className="cx-connect-ghost" onClick={onOpenModels}>{t("查看连接方法")}</button>
      </div>
    </> : <>
      <p>{t("这个网页还没有连接推理服务，所以暂时不能对话。如果是你部署的，在服务器的 .env 里填写 CIRO_API_BASE_URL 后重启；如果是别人部署的，请联系管理员。")}</p>
      <div className="cx-connect-row"><button type="button" onClick={onOpenModels}><Settings2 size={16}/>{t("查看连接方法")}</button></div>
    </>}
  </div>;
}
