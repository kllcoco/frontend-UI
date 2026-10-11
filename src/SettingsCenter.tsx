import { useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { ArrowDownToLine, Check, ChevronRight, Clock3, Code2, Database, FileText, Globe2, Image as ImageIcon, Info, Keyboard, LayoutGrid, MessageSquare, Moon, Palette, RefreshCcw, RotateCcw, Settings2, ShieldCheck, Sparkles, Sun, Trash2, UploadCloud, X } from "lucide-react";
import CiroMark from "./components/CiroMark";
import type { AppearanceSettings } from "./lib/appearance";
import { backgroundUrl, DEFAULT_APPEARANCE, WALLPAPER_PRESETS } from "./lib/appearance";
import type { ChatPreferences } from "./lib/preferences";
import type { ApiStatus, Conversation } from "./types";

type Section = "general" | "appearance" | "models" | "chat" | "storage" | "shortcuts" | "security" | "about";
type SettingsProps = {
  onClose: () => void;
  theme: "light" | "dark";
  onThemeChange: (value: "light" | "dark") => void;
  appearance: AppearanceSettings;
  onAppearanceChange: (value: AppearanceSettings) => void;
  customImageUrl: string | null;
  onUploadImage: (file: File) => Promise<void>;
  onRemoveImage: () => Promise<void>;
  preferences: ChatPreferences;
  onPreferencesChange: (value: ChatPreferences) => void;
  status: ApiStatus;
  model: string;
  onModelChange: (value: string) => void;
  onRefreshStatus: () => Promise<void>;
  conversations: Conversation[];
  onExportAll: () => void;
  onClearHistory: () => void;
};
const sections: { id: Section; label: string; icon: typeof Palette }[] = [
  { id: "general", label: "通用设置", icon: Settings2 },
  { id: "appearance", label: "外观与背景", icon: Palette },
  { id: "models", label: "模型设置", icon: Sparkles },
  { id: "chat", label: "对话设置", icon: MessageSquare },
  { id: "storage", label: "文件与存储", icon: Database },
  { id: "shortcuts", label: "快捷键", icon: Keyboard },
  { id: "security", label: "隐私与安全", icon: ShieldCheck },
  { id: "about", label: "关于 Ciro", icon: Info }
];
function SettingBlock({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return <section className="sc-section"><div className="sc-section-intro"><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{children}</section>;
}
function SettingRow({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <div className="sc-setting-row"><div><strong>{title}</strong>{description && <p>{description}</p>}</div><div className="sc-setting-control">{children}</div></div>;
}
function Toggle({ checked, onChange, title }: { checked: boolean; onChange: (next: boolean) => void; title: string }) {
  return <button type="button" role="switch" aria-label={title} aria-checked={checked}
    className={checked ? "sc-switch sc-switch--on" : "sc-switch"} onClick={() => onChange(!checked)}><span /></button>;
}
function Slider({ title, value, min, max, suffix, onChange }: {
  title: string; value: number; min: number; max: number; suffix: string; onChange: (value: number) => void;
}) {
  return <label className="sc-slider-row"><span>{title}</span><input type="range" min={min} max={max} value={value}
    onChange={(event) => onChange(Number(event.target.value))}/><output>{value}{suffix}</output></label>;
}

export default function SettingsCenter({
  onClose, theme, onThemeChange, appearance, onAppearanceChange, customImageUrl,
  onUploadImage, onRemoveImage, preferences, onPreferencesChange, status, model,
  onModelChange, onRefreshStatus, conversations, onExportAll, onClearHistory
}: SettingsProps) {
  const [section, setSection] = useState<Section>("appearance");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const totalMessages = conversations.reduce((sum, chat) => sum + chat.messages.length, 0);
  const wallpaper = backgroundUrl(appearance.preset, customImageUrl);

  function updateAppearance<K extends keyof AppearanceSettings>(key: K, value: AppearanceSettings[K]) {
    onAppearanceChange({ ...appearance, [key]: value });
  }
  function updatePreference<K extends keyof ChatPreferences>(key: K, value: ChatPreferences[K]) {
    onPreferencesChange({ ...preferences, [key]: value });
  }
  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    try { await onUploadImage(file); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "背景图片保存失败"); }
    finally { setUploading(false); }
  }
  async function removeBackground() {
    try { await onRemoveImage(); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "删除背景图片失败"); }
  }
  const heading = sections.find((item) => item.id === section)?.label || "设置";

  return <div className="sc-backdrop" role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="sc-shell" role="dialog" aria-modal="true" aria-labelledby="sc-title">
      <aside className="sc-nav">
        <div className="sc-logo"><CiroMark small/><div><strong>CIRO</strong><span>PERSONAL SETTINGS</span></div></div>
        <div className="sc-nav-label">偏好与配置</div>
        <nav aria-label="设置类别">{sections.map(({ id, label, icon: Icon }) => <button type="button" key={id}
          className={section === id ? "sc-nav-item sc-nav-item--active" : "sc-nav-item"}
          onClick={() => { setSection(id); setError(null); }}><Icon size={17}/><span>{label}</span><ChevronRight size={13} className="sc-nav-arrow"/></button>)}</nav>
        <div className="sc-nav-foot"><ShieldCheck size={15}/> 本地优先 · 由你掌控</div>
      </aside>
      <div className="sc-main">
        <header className="sc-header"><div><span className="sc-kicker">PERSONALIZE YOUR CIRO</span><h2 id="sc-title">{heading}</h2></div>
          <button className="sc-close" onClick={onClose} title="关闭设置" aria-label="关闭设置"><X size={20}/></button></header>
        <div className="sc-scroll">
          {section === "appearance" && <>
            <div className="sc-section-heading"><div><h3>把 Ciro 变成你的空间</h3><p>选一处风景，或上传只属于你的背景。每次调整都会立即生效。</p></div>
              <span className="sc-save-status"><Check size={14}/> 自动保存</span></div>
            <div className="sc-preview">
              <div className="sc-preview-wallpaper" style={{ backgroundImage: "url('" + wallpaper + "')",
                filter: "blur(" + appearance.blur + "px) brightness(" + appearance.brightness / 100 + ")" }} aria-hidden="true"/>
              <div className="sc-preview-dimmer" style={{ backgroundColor: "rgba(1,12,14," + appearance.overlay / 100 + ")" }} aria-hidden="true"/>
              <div className="sc-preview-glass"><CiroMark small/><span><strong>你好，我是 Ciro。</strong><small>让每一个想法，走得更远。</small></span></div>
              <span className="sc-preview-label">实时预览 · 模糊 {appearance.blur}px</span>
            </div>
            <SettingBlock title="主题模式" subtitle="背景与界面颜色可以独立设置">
              <div className="sc-theme-grid">
                <button className={theme === "dark" ? "sc-theme-button sc-theme-button--active" : "sc-theme-button"} onClick={() => onThemeChange("dark")}>
                  <Moon size={18}/><span>深色月夜</span>{theme === "dark" && <Check size={16}/>}</button>
                <button className={theme === "light" ? "sc-theme-button sc-theme-button--active" : "sc-theme-button"} onClick={() => onThemeChange("light")}>
                  <Sun size={18}/><span>浅色日光</span>{theme === "light" && <Check size={16}/>}</button>
              </div>
            </SettingBlock>
            <SettingBlock title="背景图库" subtitle="五套内置壁纸无需联网；自定义图片仅保存在当前设备">
              <div className="sc-wallpaper-grid">
                {WALLPAPER_PRESETS.map(({ id, name, url }) => <button type="button" key={id}
                  className={appearance.preset === id ? "sc-wallpaper-tile sc-wallpaper-tile--active" : "sc-wallpaper-tile"}
                  onClick={() => updateAppearance("preset", id)} aria-pressed={appearance.preset === id}>
                  <span className="sc-wallpaper-thumb" style={{ backgroundImage: "url('" + url + "')" }}>
                    {appearance.preset === id && <span className="sc-thumb-check"><Check size={15}/></span>}</span>
                  <span className="sc-wallpaper-title">{name}</span></button>)}
                {customImageUrl && <button type="button"
                  className={appearance.preset === "custom" ? "sc-wallpaper-tile sc-wallpaper-tile--active" : "sc-wallpaper-tile"}
                  onClick={() => updateAppearance("preset", "custom")}>
                  <span className="sc-wallpaper-thumb" style={{ backgroundImage: "url('" + customImageUrl + "')" }}>
                    {appearance.preset === "custom" && <span className="sc-thumb-check"><Check size={15}/></span>}</span>
                  <span className="sc-wallpaper-title">我的背景</span></button>}
                <button type="button" className="sc-wallpaper-tile sc-upload-tile" disabled={uploading} onClick={() => inputRef.current?.click()}>
                  <span className="sc-wallpaper-thumb sc-upload-thumb"><UploadCloud size={21}/></span>
                  <span className="sc-wallpaper-title">{uploading ? "上传中…" : "自定义上传"}</span></button>
                <input type="file" hidden ref={inputRef} accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => { void handleUpload(event); }}/>
              </div>
              {appearance.preset === "custom" && !customImageUrl && <p className="sc-warning">无法读取之前的自定义背景，已暂时显示默认壁纸。</p>}
              {error && <p className="sc-error" role="alert">{error}</p>}
              <div className="sc-wallpaper-extras"><span><ImageIcon size={15}/> JPG / PNG / WebP / AVIF · 最大 8 MB</span>
                {customImageUrl && <button onClick={() => void removeBackground()}><Trash2 size={14}/> 删除自定义背景</button>}</div>
            </SettingBlock>
            <SettingBlock title="背景效果" subtitle="调整后实时应用于主界面">
              <div className="sc-sliders">
                <Slider title="背景亮度" value={appearance.brightness} min={20} max={120} suffix="%" onChange={(v) => updateAppearance("brightness", v)}/>
                <Slider title="模糊程度" value={appearance.blur} min={0} max={24} suffix="px" onChange={(v) => updateAppearance("blur", v)}/>
                <Slider title="暗色遮罩" value={appearance.overlay} min={0} max={85} suffix="%" onChange={(v) => updateAppearance("overlay", v)}/>
              </div>
            </SettingBlock>
            <SettingBlock title="应用范围"><div className="sc-segmented">
              <button className={appearance.scope === "all" ? "sc-selected" : ""} onClick={() => updateAppearance("scope", "all")}><LayoutGrid size={16}/> 整个客户端</button>
              <button className={appearance.scope === "welcome" ? "sc-selected" : ""} onClick={() => updateAppearance("scope", "welcome")}><ImageIcon size={16}/> 仅欢迎页面</button>
            </div></SettingBlock>
            <div className="sc-panel-actions"><button className="sc-action-secondary" onClick={() => onAppearanceChange({ ...DEFAULT_APPEARANCE })}>
              <RotateCcw size={15}/> 恢复默认外观</button></div>
          </>}

          {section === "general" && <>
            <SettingBlock title="语言与输入">
              <SettingRow title="界面语言" description="首个版本提供简体中文界面"><span className="sc-static-value"><Globe2 size={16}/> 简体中文</span></SettingRow>
              <SettingRow title="Enter 发送消息" description="关闭后改为 Ctrl / ⌘ + Enter 发送">
                <Toggle checked={preferences.sendWithEnter} title="Enter 发送消息" onChange={(v) => updatePreference("sendWithEnter", v)}/></SettingRow>
              <SettingRow title="减少界面动画" description="关闭渐变滚动和过渡动画">
                <Toggle checked={preferences.reduceMotion} title="减少界面动画" onChange={(v) => updatePreference("reduceMotion", v)}/></SettingRow>
            </SettingBlock>
            <div className="sc-info-card"><Sparkles size={18}/><div><strong>你的设置会自动保存</strong><p>目前仅保存到当前浏览器，不会自动同步到其他设备。</p></div></div>
          </>}

          {section === "models" && <>
            <SettingBlock title="模型连接" subtitle="只显示后端实际提供的模型，不展示未经验证的能力">
              <div className="sc-model-status"><span className={status.configured ? "sc-model-indicator sc-model-indicator--ready" : "sc-model-indicator"}/>
                <div><strong>{status.configured ? "已读取服务端配置" : "等待 CIRO 推理服务接入"}</strong>
                  <p>{status.configured ? "地址已配置；实际推理连通性在发送消息时确认。" : "目前是界面预览，不会生成虚假的模型回复。"}</p></div>
                <button className="sc-action-secondary" onClick={() => void onRefreshStatus()}><RefreshCcw size={15}/> 刷新</button></div>
              <div className="sc-models">{status.models.map((item) => <button type="button" key={item}
                className={item === model ? "sc-model-option sc-model-option--active" : "sc-model-option"} onClick={() => onModelChange(item)}>
                <CiroMark small/><span><strong>{item === "ciro" ? "Ciro" : item}</strong>
                  <small>{status.configured ? "由已配置后端提供" : "占位模型 · 暂无推理"}</small></span>{item === model && <Check size={17}/>}</button>)}</div>
            </SettingBlock>
            <SettingBlock title="连接方法">
              <p className="sc-help-text">在服务端项目根目录 <code>.env</code> 配置 CIRO 推理服务。浏览器不会保存你的 API Key。</p>
              <pre className="sc-code">CIRO_API_BASE_URL=http://127.0.0.1:8000/v1{"\n"}CIRO_MODEL=ciro{"\n"}CIRO_API_PATH=/chat/completions</pre>
              <p className="sc-help-text">当前代理使用兼容 Chat Completions 的协议。如果 CIRO 正式 API 不同，需要适配后端。</p>
            </SettingBlock>
          </>}

          {section === "chat" && <>
            <SettingBlock title="对话显示">
              <SettingRow title="显示消息时间" description="每条消息下方显示时间">
                <Toggle checked={preferences.showTime} title="显示消息时间" onChange={(v) => updatePreference("showTime", v)}/></SettingRow>
              <SettingRow title="紧凑显示" description="缩短消息之间的间距">
                <Toggle checked={preferences.compactMessages} title="紧凑显示" onChange={(v) => updatePreference("compactMessages", v)}/></SettingRow>
            </SettingBlock>
            <SettingBlock title="正文字号"><div className="sc-segmented">
              {([["small","偏小"],["normal","标准"],["large","偏大"]] as const).map(([id,label]) => <button key={id}
                className={preferences.fontSize === id ? "sc-selected" : ""} onClick={() => updatePreference("fontSize", id)}>{label}</button>)}
            </div></SettingBlock>
            <div className="sc-info-card"><MessageSquare size={18}/><div><strong>按你习惯的方式思考</strong><p>字号和密度调整后，现有对话也会同步更新。</p></div></div>
          </>}

          {section === "storage" && <>
            <SettingBlock title="本地数据"><div className="sc-data-grid">
              <div><strong>{conversations.length}</strong><span>保存的对话</span></div>
              <div><strong>{totalMessages}</strong><span>消息总数</span></div>
              <div><strong>本设备</strong><span>数据位置</span></div>
            </div>
              <p className="sc-help-text">历史对话保存在 localStorage，自定义背景使用 IndexedDB。本版本没有账号同步和云端备份。</p>
              <div className="sc-action-list">
                <button className="sc-action-secondary" disabled={conversations.length === 0} onClick={onExportAll}><ArrowDownToLine size={17}/> 导出全部对话 JSON</button>
                <button className="sc-action-danger" disabled={conversations.length === 0} onClick={onClearHistory}><Trash2 size={17}/> 删除全部本地对话</button>
              </div></SettingBlock>
            <SettingBlock title="附件支持"><div className="sc-info-card"><FileText size={18}/><div><strong>文本与代码文件</strong>
              <p>最多三个文本文件（每个 80 KB），作为消息内容发送。图片理解和永久文件库尚未接入。</p>
            </div></div></SettingBlock>
          </>}

          {section === "shortcuts" && <>
            <SettingBlock title="常用快捷键">
              {[
                ["搜索历史","Ctrl / ⌘","K"],
                ["新建对话","Ctrl / ⌘","Shift","O"],
                ["输入换行","Shift","Enter"],
                ["发送消息",...(preferences.sendWithEnter ? ["Enter"] : ["Ctrl / ⌘","Enter"])]
              ].map(([name,...keys]) => <div className="sc-shortcut" key={name}><span>{name}</span>
                <div>{keys.map((key) => <kbd key={key}>{key}</kbd>)}</div></div>)}
            </SettingBlock>
            <p className="sc-help-text">快捷键会跟随「通用设置」中的发送方式变化。</p>
          </>}

          {section === "security" && <>
            <SettingBlock title="隐私边界">
              <div className="sc-security-line"><ShieldCheck size={19}/><div><strong>模型密钥保留在服务端</strong><p>前端只向本项目的 API 代理发消息，不会把 CIRO_API_KEY 存到浏览器。</p></div></div>
              <div className="sc-security-line"><Database size={19}/><div><strong>对话本机保存</strong><p>历史记录存储在此浏览器；连接后端后，发送的消息会传给你配置的推理服务。</p></div></div>
              <div className="sc-security-line"><Code2 size={19}/><div><strong>尚未提供公网账号安全体系</strong><p>当前 MVP 没有登录、限流或计费安全网关，不应直接暴露到公网。</p></div></div>
            </SettingBlock>
          </>}

          {section === "about" && <>
            <div className="sc-about-hero"><CiroMark/><strong>Ciro</strong><span>Think further.</span>
              <p>与你一起，探索思考的另一种可能。</p><small>CIRO CLIENT · PREVIEW v0.2</small></div>
            <SettingBlock title="项目"><SettingRow title="客户端仓库" description="独立于 NCPA 模型和验收主线">
              <a className="sc-repo-link" href="https://github.com/kllcoco/frontend-UI" target="_blank" rel="noopener noreferrer">frontend-UI ↗</a></SettingRow>
              <SettingRow title="推理能力" description="实际能力以服务端正式验收为准"><span className="sc-static-value">待接入</span></SettingRow>
            </SettingBlock>
          </>}
        </div>
        <footer className="sc-footer"><span><Clock3 size={13}/> 设置自动保存到此浏览器</span>
          <button onClick={onClose}>完成 <Check size={15}/></button></footer>
      </div>
    </section>
  </div>;
}
