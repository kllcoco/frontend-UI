import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { ArrowDownToLine, CalendarClock, Check, ChevronRight, Clock3, Code2, Database, FileText, GitBranch, Image as ImageIcon, Info, Keyboard, LayoutGrid, MessageSquare, Moon, Palette, PlugZap, RefreshCcw, RotateCcw, Settings2, ShieldCheck, Sparkles, Sun, Trash2, UploadCloud, UserRound, Users, Wallet, X, Monitor } from "lucide-react";
import CiroMark from "./components/CiroMark";
import type { AppearanceSettings } from "./lib/appearance";
import { backgroundUrl, DEFAULT_APPEARANCE, WALLPAPER_PRESETS } from "./lib/appearance";
import type { ChatPreferences } from "./lib/preferences";
import { ACCENTS } from "./lib/preferences";
const ACCENT_NAMES = { jade: "翡翠绿", blue: "湖蓝", violet: "紫罗兰", amber: "琥珀", rose: "玫瑰", graphite: "石墨" } as const;
import type { ApiStatus, Conversation } from "./types";
import { LANGUAGES, translate, systemLanguage } from "./lib/i18n";
import type { Language, LanguagePref } from "./lib/i18n";
import type { ThemePref } from "./lib/storage";
import { connectServer, disconnectServer, isMobileShell, isRemoteMobile, normalizeServer, savedServer } from "./lib/mobile";
import WorkbenchCenter from "./WorkbenchCenter";
import ConversationManager from "./components/ConversationManager";
import MemoryManager from "./components/MemoryManager";
import TeamCenter from "./components/TeamCenter";
import type { BulkAction } from "./components/ConversationManager";
import AccountCenter from "./AccountCenter";
import type {AccountTab} from "./lib/account-api";
import type { CustomInstructions } from "./lib/instructions";
import type { WorkbenchTab } from "./lib/workbench-api";

type Section = "general" | "instructions" | "appearance" | "models" | "chat" | "storage" | "shortcuts" | "security" | "about" | "team" | WorkbenchTab;
type SettingsProps = {
  onClose: () => void;
  initialSection?: string;
  language: Language;
  languagePref: LanguagePref;
  onLanguagePrefChange: (language: LanguagePref) => void;
  themePref: ThemePref;
  onThemePrefChange: (value: ThemePref) => void;
  displayName: string;
  onDisplayNameChange: (value: string) => void;
  appearance: AppearanceSettings;
  onAppearanceChange: (value: AppearanceSettings) => void;
  customImageUrl: string | null;
  onUploadImage: (file: File) => Promise<void>;
  onRemoveImage: () => Promise<void>;
  preferences: ChatPreferences;
  onPreferencesChange: (value: ChatPreferences) => void;
  instructions: CustomInstructions;
  onInstructionsChange: (value: CustomInstructions) => void;
  status: ApiStatus;
  model: string;
  onModelChange: (value: string) => void;
  onRefreshStatus: () => Promise<void>;
  conversations: Conversation[];
  onExportAll: () => void;
  onClearHistory: () => void;
  onBulk: (action: BulkAction, ids: string[]) => void;
  onImport: (items: Conversation[]) => number;
  onImportProject: (file: File) => Promise<void>;
};
const sections: { id: Section; label: string; icon: typeof Palette; group?: string }[] = [
  { id: "general", label: "通用设置", icon: Settings2, group: "偏好与配置" },
  { id: "instructions", label: "自定义指令", icon: FileText },
  { id: "appearance", label: "外观与背景", icon: Palette },
  { id: "models", label: "模型设置", icon: Sparkles },
  { id: "chat", label: "对话设置", icon: MessageSquare },
  { id: "storage", label: "文件与存储", icon: Database },
  { id: "shortcuts", label: "快捷键", icon: Keyboard },
  { id: "security", label: "隐私与安全", icon: ShieldCheck },
  { id: "about", label: "关于 Ciro", icon: Info },
  { id: "permissions", label: "代理与沙盒", icon: ShieldCheck, group: "工作台与连接" },
  { id: "github", label: "GitHub 连接", icon: GitBranch },
  { id: "plugins", label: "插件管理", icon: PlugZap },
  { id: "schedules", label: "定时任务", icon: CalendarClock },
  { id: "billing", label: "账单与用量", icon: Wallet },
  { id: "apps", label: "官方应用", icon: LayoutGrid },
  { id: "skills", label: "技能中心", icon: Sparkles },
  { id: "account", label: "账户与安全", icon: UserRound, group: "账户" },
  { id: "team", label: "团队", icon: Users },
  { id: "subscription", label: "订阅管理", icon: Wallet },
  { id: "api-keys", label: "API 密钥", icon: GitBranch },
  { id: "spending", label: "消费限额", icon: Wallet },
  { id: "notifications", label: "通知中心", icon: CalendarClock },
  { id: "memory", label: "记忆管理", icon: Database },
  { id: "sync", label: "跨设备同步", icon: RefreshCcw }
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
  onClose, initialSection, language, languagePref, onLanguagePrefChange, themePref, onThemePrefChange,
  displayName, onDisplayNameChange, appearance, onAppearanceChange, customImageUrl,
  onUploadImage, onRemoveImage, preferences, onPreferencesChange, instructions, onInstructionsChange, status, model,
  onModelChange, onRefreshStatus, conversations, onExportAll, onClearHistory, onBulk, onImport, onImportProject
}: SettingsProps) {
  const t = (value: string) => translate(language, value);
  const [section, setSection] = useState<Section>(() =>
    sections.some((item) => item.id === initialSection) ? initialSection as Section : "appearance");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const totalMessages = conversations.reduce((sum, chat) => sum + chat.messages.length, 0);
  const wallpaper = backgroundUrl(appearance.preset, customImageUrl);
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [onClose]);

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
    catch (cause) { setError(cause instanceof Error ? cause.message : t("背景图片保存失败")); }
    finally { setUploading(false); }
  }
  async function removeBackground() {
    try { await onRemoveImage(); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("删除背景图片失败")); }
  }
  const [serverInput, setServerInput] = useState(() => savedServer() || "");
  const mobile = isMobileShell();
  function connectMobileServer() {
    try { connectServer(normalizeServer(serverInput)); }
    catch { setError(t("服务器地址格式不正确，例如 http://192.168.1.10:8787")); }
  }
  const heading = sections.find((item) => item.id === section)?.label || "设置";

  return <div className="sc-backdrop" role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="sc-shell" role="dialog" aria-modal="true" aria-labelledby="sc-title">
      <aside className="sc-nav">
        <div className="sc-logo"><CiroMark small/><div><strong>CIRO</strong><span>PERSONAL SETTINGS</span></div></div>
        <nav aria-label={t("设置类别")}>{sections.map(({ id, label, icon: Icon, group }) => <div key={id} className="sc-nav-entry">
          {group && <div className="sc-nav-label">{t(group)}</div>}
          <button type="button"
          className={section === id ? "sc-nav-item sc-nav-item--active" : "sc-nav-item"} aria-current={section === id ? "page" : undefined}
          onClick={() => { setSection(id); setError(null); }}><Icon size={17}/><span>{t(label)}</span><ChevronRight size={13} className="sc-nav-arrow"/></button></div>)}</nav>
        <div className="sc-nav-foot"><ShieldCheck size={15}/> {t("本地优先 · 由你掌控")}</div>
      </aside>
      <div className="sc-main">
        <header className="sc-header"><div><span className="sc-kicker">PERSONALIZE YOUR CIRO</span><h2 id="sc-title">{t(heading)}</h2></div>
          <button className="sc-close" onClick={onClose} title={t("关闭设置")} aria-label={t("关闭设置")}><X size={20}/></button></header>
        <div className="sc-scroll">
          {(["account","subscription","api-keys","spending","notifications","memory","sync"] as string[]).includes(section) &&
            <AccountCenter key={section} language={language} section={section as AccountTab}/>}
          {(section==="permissions" || section==="github" || section==="plugins" || section==="schedules" || section==="billing" || section==="apps" || section==="skills") &&
            <WorkbenchCenter key={section} language={language} initialTab={section as WorkbenchTab} embedded />}
          {section === "team" && <TeamCenter t={t} onImportProject={onImportProject}/>}
          {section === "appearance" && <>
            <div className="sc-section-heading"><div><h3>{t("把 Ciro 变成你的空间")}</h3><p>{t("选一处风景，或上传只属于你的背景。每次调整都会立即生效。")}</p></div>
              <span className="sc-save-status"><Check size={14}/> {t("自动保存")}</span></div>
            <div className="sc-preview">
              <div className="sc-preview-wallpaper" style={{ backgroundImage: "url('" + wallpaper + "')",
                filter: "blur(" + appearance.blur + "px) brightness(" + appearance.brightness / 100 + ")" }} aria-hidden="true"/>
              <div className="sc-preview-dimmer" style={{ backgroundColor: appearance.preset === "white" ? "transparent" : "rgba(1,12,14," + appearance.overlay / 100 + ")" }} aria-hidden="true"/>
              <div className="sc-preview-glass"><CiroMark small/><span><strong>{t("你好，我是 Ciro。")}</strong><small>{t("让每一个想法，走得更远。")}</small></span></div>
              <span className="sc-preview-label">{t("实时预览 · 模糊 ")}{appearance.blur}px</span>
            </div>
            <SettingBlock title={t("主题模式")} subtitle={t("背景与界面颜色可以独立设置")}>
              <div className="sc-theme-grid sc-theme-grid--three">
                {([["light", Sun, "浅色日光"], ["dark", Moon, "深色月夜"], ["system", Monitor, "跟随系统"]] as const).map(([id, Icon, label]) =>
                  <button key={id} className={themePref === id ? "sc-theme-button sc-theme-button--active" : "sc-theme-button"}
                    aria-pressed={themePref === id} onClick={() => onThemePrefChange(id)}>
                    <Icon size={18}/><span>{t(label)}</span>{themePref === id && <Check size={16}/>}</button>)}
              </div>
            </SettingBlock>
            <SettingBlock title={t("强调色")} subtitle={t("按钮、链接与高亮使用的颜色")}>
              <div className="sc-accents" role="radiogroup" aria-label={t("强调色")}>
                {ACCENTS.map((id) => <button type="button" key={id} role="radio" aria-checked={preferences.accent === id}
                  aria-label={t(ACCENT_NAMES[id])} title={t(ACCENT_NAMES[id])} data-swatch={id}
                  className={preferences.accent === id ? "sc-accent sc-accent--on" : "sc-accent"}
                  onClick={() => updatePreference("accent", id)}><span/>{preferences.accent === id && <Check size={13}/>}</button>)}
              </div>
            </SettingBlock>
            <SettingBlock title={t("界面字体")}>
              <div className="sc-segmented">
                {([["sans", "现代无衬线"], ["system", "系统字体"], ["serif", "衬线阅读体"]] as const).map(([id, label]) =>
                  <button key={id} className={preferences.fontFamily === id ? "sc-selected" : ""} data-font-preview={id}
                    onClick={() => updatePreference("fontFamily", id)}>{t(label)}</button>)}
              </div>
            </SettingBlock>
            <SettingBlock title={t("背景图库")} subtitle={t("六套内置背景无需联网；自定义图片仅保存在当前设备")}>
              <div className="sc-wallpaper-grid">
                {WALLPAPER_PRESETS.map(({ id, name, url }) => <button type="button" key={id}
                  className={appearance.preset === id ? "sc-wallpaper-tile sc-wallpaper-tile--active" : "sc-wallpaper-tile"}
                  onClick={() => updateAppearance("preset", id)} aria-pressed={appearance.preset === id}>
                  <span className="sc-wallpaper-thumb" style={{ backgroundImage: "url('" + url + "')" }}>
                    {appearance.preset === id && <span className="sc-thumb-check"><Check size={15}/></span>}</span>
                  <span className="sc-wallpaper-title">{t(name)}</span></button>)}
                {customImageUrl && <button type="button"
                  className={appearance.preset === "custom" ? "sc-wallpaper-tile sc-wallpaper-tile--active" : "sc-wallpaper-tile"}
                  onClick={() => updateAppearance("preset", "custom")}>
                  <span className="sc-wallpaper-thumb" style={{ backgroundImage: "url('" + customImageUrl + "')" }}>
                    {appearance.preset === "custom" && <span className="sc-thumb-check"><Check size={15}/></span>}</span>
                  <span className="sc-wallpaper-title">{t("我的背景")}</span></button>}
                <button type="button" className="sc-wallpaper-tile sc-upload-tile" disabled={uploading} onClick={() => inputRef.current?.click()}>
                  <span className="sc-wallpaper-thumb sc-upload-thumb"><UploadCloud size={21}/></span>
                  <span className="sc-wallpaper-title">{uploading ? t("上传中…") : t("自定义上传")}</span></button>
                <input type="file" hidden ref={inputRef} accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => { void handleUpload(event); }}/>
              </div>
              {appearance.preset === "custom" && !customImageUrl && <p className="sc-warning">{t("无法读取之前的自定义背景，已暂时显示默认壁纸。")}</p>}
              {error && <p className="sc-error" role="alert">{error}</p>}
              <div className="sc-wallpaper-extras"><span><ImageIcon size={15}/> {t("JPG / PNG / WebP / AVIF · 最大 8 MB")}</span>
                {customImageUrl && <button onClick={() => void removeBackground()}><Trash2 size={14}/> {t("删除自定义背景")}</button>}</div>
            </SettingBlock>
            <SettingBlock title={t("背景效果")} subtitle={t("调整后实时应用于主界面")}>
              <div className="sc-sliders">
                <Slider title={t("背景亮度")} value={appearance.brightness} min={20} max={120} suffix="%" onChange={(v) => updateAppearance("brightness", v)}/>
                <Slider title={t("模糊程度")} value={appearance.blur} min={0} max={24} suffix="px" onChange={(v) => updateAppearance("blur", v)}/>
                <Slider title={t("暗色遮罩")} value={appearance.overlay} min={0} max={85} suffix="%" onChange={(v) => updateAppearance("overlay", v)}/>
              </div>
            </SettingBlock>
            <SettingBlock title={t("应用范围")}><div className="sc-segmented">
              <button className={appearance.scope === "all" ? "sc-selected" : ""} onClick={() => updateAppearance("scope", "all")}><LayoutGrid size={16}/> {t("整个客户端")}</button>
              <button className={appearance.scope === "welcome" ? "sc-selected" : ""} onClick={() => updateAppearance("scope", "welcome")}><ImageIcon size={16}/> {t("仅欢迎页面")}</button>
            </div></SettingBlock>
            <div className="sc-panel-actions"><button className="sc-action-secondary" onClick={() => onAppearanceChange({ ...DEFAULT_APPEARANCE })}>
              <RotateCcw size={15}/> {t("恢复默认外观")}</button></div>
          </>}

          {section === "general" && <>
            <SettingBlock title={t("个人资料")} subtitle={t("显示在左下角的个人菜单中；登录账户后使用账户名称。")}>
              <SettingRow title={t("你的名字")} description={t("Ciro 会用它来问候你。")}>
                <input className="sc-text-input" aria-label={t("你的名字")} maxLength={40} value={displayName}
                  placeholder={t("本地访客")} onChange={(event) => onDisplayNameChange(event.target.value)}/>
              </SettingRow>
            </SettingBlock>
            <SettingBlock title={t("语言与输入")}>
              <SettingRow title={t("界面语言")} description={t("跟随系统时，菜单与界面会随操作系统语言自动切换。")}>
                <div className="sc-language-switch" role="group" aria-label={t("界面语言")}>
                  <button type="button" className={languagePref === "system" ? "sc-language-option sc-language-option--active" : "sc-language-option"}
                    aria-pressed={languagePref === "system"} onClick={() => onLanguagePrefChange("system")}
                    title={LANGUAGES.find((l) => l.id === systemLanguage())?.label}>{t("跟随系统")}</button>
                  {LANGUAGES.map(({ id, label }) => <button type="button" key={id}
                    className={languagePref === id ? "sc-language-option sc-language-option--active" : "sc-language-option"}
                    aria-pressed={languagePref === id} onClick={() => onLanguagePrefChange(id)}>{label}</button>)}
                </div>
              </SettingRow>
              <SettingRow title={t("Enter 发送消息")} description={t("关闭后改为 Ctrl / ⌘ + Enter 发送")}>
                <Toggle checked={preferences.sendWithEnter} title={t("Enter 发送消息")} onChange={(v) => updatePreference("sendWithEnter", v)}/></SettingRow>
              <SettingRow title={t("减少界面动画")} description={t("关闭渐变滚动和过渡动画")}>
                <Toggle checked={preferences.reduceMotion} title={t("减少界面动画")} onChange={(v) => updatePreference("reduceMotion", v)}/></SettingRow>
            </SettingBlock>
            <div className="sc-info-card"><Sparkles size={18}/><div><strong>{t("你的设置会自动保存")}</strong><p>{t("默认保存在当前设备；登录后可在「跨设备同步」中开启云端同步。")}</p></div></div>
          </>}

          {section === "instructions" && <>
            <SettingBlock title={t("自定义指令")} subtitle={t("决定 Ciro 如何理解你的背景，以及如何回答。")}>
              <SettingRow title={t("启用自定义指令")} description={t("启用后随普通聊天请求发送到你配置的模型服务。")}>
                <Toggle checked={instructions.enabled} title={t("启用自定义指令")}
                  onChange={value=>onInstructionsChange({...instructions,enabled:value})}/>
              </SettingRow>
              <label className="sc-instructions-field"><strong>{t("关于你")}</strong>
                <span>{t("可填写角色、偏好和长期目标，最多 2000 字。")}</span>
                <textarea aria-label={t("关于你")} maxLength={2000} rows={4} value={instructions.about}
                  onChange={event=>onInstructionsChange({...instructions,about:event.target.value})}
                  placeholder={t("例如：我正在开发 CIRO，回答时先给结论。")}/>
                <small>{instructions.about.length}/2000</small>
              </label>
              <label className="sc-instructions-field"><strong>{t("希望 Ciro 如何回答")}</strong>
                <span>{t("对语言、格式、严谨程度和交付物的偏好。")}</span>
                <textarea aria-label={t("希望 Ciro 如何回答")} maxLength={2000} rows={4} value={instructions.style}
                  onChange={event=>onInstructionsChange({...instructions,style:event.target.value})}
                  placeholder={t("例如：中文优先，重要工程结论必须附验证证据。")}/>
                <small>{instructions.style.length}/2000</small>
              </label>
            </SettingBlock>
            <SettingBlock title={t("记忆")} subtitle={t("Ciro 会在对话中参考这些关于你的信息；临时对话不会使用记忆。")}>
              <SettingRow title={t("启用记忆")} description={t("登录账户时记忆加密保存在服务器，否则保存在此设备")}>
                <Toggle checked={preferences.memoryEnabled} title={t("启用记忆")} onChange={(v) => updatePreference("memoryEnabled", v)}/></SettingRow>
              <MemoryManager t={t} enabled={preferences.memoryEnabled}/>
            </SettingBlock>
            <div className="sc-info-card"><ShieldCheck size={18}/><div>
              <strong>{t("本地保存，模型调用时发送")}</strong>
              <p>{t("指令保存在当前浏览器；启用后会发送到配置的推理服务，但不能替代沙盒或 GitHub 权限设置。")}</p>
            </div></div>
          </>}

          {section === "models" && <>
            {mobile && <SettingBlock title={t("连接 Ciro 服务器")} subtitle={t("手机端内置离线界面；连接你部署的 Ciro 服务器后即可使用真实模型、账户与同步。")}>
              {isRemoteMobile()
                ? <div className="sc-model-status"><span className="sc-model-indicator sc-model-indicator--ready"/>
                    <div><strong>{t("已连接")}</strong><p>{window.location.origin}</p></div>
                    <button className="sc-action-secondary" onClick={disconnectServer}>{t("断开并使用离线模式")}</button></div>
                : <div className="sc-mobile-server">
                    <input className="sc-text-input" inputMode="url" autoCapitalize="off" autoCorrect="off" aria-label={t("服务器地址")}
                      placeholder="http://192.168.1.10:8787" value={serverInput} onChange={(e) => setServerInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") connectMobileServer(); }}/>
                    <button className="sc-action-secondary" disabled={!serverInput.trim()} onClick={connectMobileServer}>{t("连接")}</button>
                  </div>}
              {error && <p className="sc-error" role="alert">{error}</p>}
            </SettingBlock>}
            <SettingBlock title={t("模型连接")} subtitle={t("只显示后端实际提供的模型，不展示未经验证的能力")}>
              <div className="sc-model-status"><span className={status.configured ? "sc-model-indicator sc-model-indicator--ready" : "sc-model-indicator"}/>
                <div><strong>{status.configured ? t("已读取服务端配置") : t("等待 CIRO 推理服务接入")}</strong>
                  <p>{status.configured ? t("地址已配置；实际推理连通性在发送消息时确认。") : t("目前是界面预览，不会生成虚假的模型回复。")}</p></div>
                <button className="sc-action-secondary" onClick={() => void onRefreshStatus()}><RefreshCcw size={15}/> {t("刷新")}</button></div>
              <div className="sc-models">{status.models.map((item) => <button type="button" key={item}
                className={item === model ? "sc-model-option sc-model-option--active" : "sc-model-option"} onClick={() => onModelChange(item)}>
                <CiroMark small/><span><strong>{item === "ciro" ? "Ciro" : item}</strong>
                  <small>{status.configured ? t("由已配置后端提供") : t("占位模型 · 暂无推理")}</small></span>{item === model && <Check size={17}/>}</button>)}</div>
            </SettingBlock>
            <SettingBlock title={t("连接方法")}>
              <p className="sc-help-text">{t("在服务端项目根目录")} <code>.env</code> {t("配置 CIRO 推理服务。浏览器不会保存你的 API Key。")}</p>
              <pre className="sc-code">CIRO_API_BASE_URL=http://127.0.0.1:8000/v1{"\n"}CIRO_MODEL=ciro{"\n"}CIRO_API_PATH=/chat/completions</pre>
              <p className="sc-help-text">{t("当前代理使用兼容 Chat Completions 的协议。如果 CIRO 正式 API 不同，需要适配后端。")}</p>
            </SettingBlock>
          </>}

          {section === "chat" && <>
            <SettingBlock title={t("对话显示")}>
              <SettingRow title={t("显示消息时间")} description={t("每条消息下方显示时间")}>
                <Toggle checked={preferences.showTime} title={t("显示消息时间")} onChange={(v) => updatePreference("showTime", v)}/></SettingRow>
              <SettingRow title={t("紧凑显示")} description={t("缩短消息之间的间距")}>
                <Toggle checked={preferences.compactMessages} title={t("紧凑显示")} onChange={(v) => updatePreference("compactMessages", v)}/></SettingRow>
              <SettingRow title={t("回答完成时通知")} description={t("窗口不在前台时，用系统通知提醒你回答已完成")}>
                <Toggle checked={preferences.notifyOnComplete} title={t("回答完成时通知")} onChange={(v) => {
                  if (!v) { updatePreference("notifyOnComplete", false); return; }
                  if (!("Notification" in window)) { setError(t("当前环境不支持系统通知")); return; }
                  void Notification.requestPermission().then((perm) => {
                    if (perm === "granted") updatePreference("notifyOnComplete", true);
                    else setError(t("通知权限被拒绝，请在系统或浏览器设置中允许"));
                  });
                }}/></SettingRow>
              <SettingRow title={t("追问建议")} description={t("回答结束后，在下方给出可以一键继续的问题")}>
                <Toggle checked={preferences.followUps} title={t("追问建议")} onChange={(v) => updatePreference("followUps", v)}/></SettingRow>
              <SettingRow title={t("自动生成对话标题")} description={t("第一轮回答后，由模型为对话起一个简短标题")}>
                <Toggle checked={preferences.autoTitle} title={t("自动生成对话标题")} onChange={(v) => updatePreference("autoTitle", v)}/></SettingRow>
              {error && <p className="sc-error" role="alert">{error}</p>}
            </SettingBlock>
            <SettingBlock title={t("正文字号")}><div className="sc-segmented">
              {([["small",t("偏小")],["normal",t("标准")],["large",t("偏大")]] as const).map(([id,label]) => <button key={id}
                className={preferences.fontSize === id ? "sc-selected" : ""} onClick={() => updatePreference("fontSize", id)}>{label}</button>)}
            </div></SettingBlock>
            <div className="sc-info-card"><MessageSquare size={18}/><div><strong>{t("按你习惯的方式思考")}</strong><p>{t("字号和密度调整后，现有对话也会同步更新。")}</p></div></div>
          </>}

          {section === "storage" && <>
            <SettingBlock title={t("本地数据")}><div className="sc-data-grid">
              <div><strong>{conversations.length}</strong><span>{t("保存的对话")}</span></div>
              <div><strong>{totalMessages}</strong><span>{t("消息总数")}</span></div>
              <div><strong>{t("本设备")}</strong><span>{t("数据位置")}</span></div>
            </div>
              <p className="sc-help-text">{t("历史对话保存在 localStorage，图片附件与自定义背景使用 IndexedDB。登录后可在「跨设备同步」中开启云端同步。")}</p>
              <div className="sc-action-list">
                <button className="sc-action-secondary" disabled={conversations.length === 0} onClick={onExportAll}><ArrowDownToLine size={17}/> {t("导出全部对话 JSON")}</button>
                <button className="sc-action-danger" disabled={conversations.length === 0} onClick={onClearHistory}><Trash2 size={17}/> {t("删除全部本地对话")}</button>
              </div></SettingBlock>
            <SettingBlock title={t("管理对话")} subtitle={t("导入、归档、批量导出或删除本地对话")}>
              <ConversationManager t={t} conversations={conversations} onBulk={onBulk}
                onImport={onImport} onError={(text) => setError(text)}/>
              {error && <p className="sc-error" role="alert">{error}</p>}
            </SettingBlock>
            <SettingBlock title={t("附件支持")}><div className="sc-info-card"><FileText size={18}/><div><strong>{t("文本与代码文件")}</strong>
              <p>{t("每次最多 5 个附件：图片（自动压缩，按多模态格式发送）、PDF（在本机提取文字）、文本或代码文件。模型能否理解图片取决于后端。")}</p>
            </div></div></SettingBlock>
          </>}

          {section === "shortcuts" && <>
            <SettingBlock title={t("常用快捷键")}>
              {[
                [t("搜索历史"),"Ctrl / ⌘","K"],
                [t("新建对话"),"Ctrl / ⌘","Shift","O"],
                [t("折叠 / 展开侧栏"),"Ctrl / ⌘","Shift","S"],
                [t("打开设置"),"Ctrl / ⌘",","],
                [t("查看快捷键"),"Ctrl / ⌘","/"],
                [t("停止生成"),"Esc"],
                [t("编辑上一条消息"),"↑"],
                [t("上一个 / 下一个对话"),"Alt","↑ / ↓"],
                [t("在对话中查找"),"Ctrl / ⌘","F"],
                [t("导出 PDF / 打印"),"Ctrl / ⌘","P"],
                [t("重命名选中的对话"),"F2"],
                [t("输入换行"),"Shift","Enter"],
                [t("发送消息"),...(preferences.sendWithEnter ? ["Enter"] : ["Ctrl / ⌘","Enter"])]
              ].map(([name,...keys]) => <div className="sc-shortcut" key={name}><span>{name}</span>
                <div>{keys.map((key) => <kbd key={key}>{key}</kbd>)}</div></div>)}
            </SettingBlock>
            <p className="sc-help-text">{t("快捷键会跟随「通用设置」中的发送方式变化。")}</p>
          </>}

          {section === "security" && <>
            <SettingBlock title={t("隐私边界")}>
              <div className="sc-security-line"><ShieldCheck size={19}/><div><strong>{t("模型密钥保留在服务端")}</strong><p>{t("前端只向本项目的 API 代理发消息，不会把 CIRO_API_KEY 存到浏览器。")}</p></div></div>
              <div className="sc-security-line"><Database size={19}/><div><strong>{t("对话本机保存")}</strong><p>{t("历史记录存储在此浏览器；连接后端后，发送的消息会传给你配置的推理服务。")}</p></div></div>
              <div className="sc-security-line"><Code2 size={19}/><div><strong>{t("尚未提供公网账号安全体系")}</strong><p>{t("当前 MVP 没有登录、限流或计费安全网关，不应直接暴露到公网。")}</p></div></div>
            </SettingBlock>
          </>}

          {section === "about" && <>
            <div className="sc-about-hero"><CiroMark/><strong>Ciro</strong><span>Think further.</span>
              <p>{t("与你一起，探索思考的另一种可能。")}</p><small>CIRO CLIENT · v0.9.3</small></div>
            <SettingBlock title={t("项目")}><SettingRow title={t("客户端仓库")} description={t("独立于 NCPA 模型和验收主线")}>
              <a className="sc-repo-link" href="https://github.com/kllcoco/frontend-UI" target="_blank" rel="noopener noreferrer">frontend-UI ↗</a></SettingRow>
              <SettingRow title={t("推理能力")} description={t("实际能力以服务端正式验收为准")}><span className="sc-static-value">{t("待接入")}</span></SettingRow>
            </SettingBlock>
          </>}
        </div>
        <footer className="sc-footer"><span><Clock3 size={13}/> {t("设置自动保存到此浏览器")}</span>
          <button onClick={onClose}>{t("完成")} <Check size={15}/></button></footer>
      </div>
    </section>
  </div>;
}
