import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Bell, Check, Cloud, Users, ChevronRight, ChevronsUpDown, CircleHelp, Download, Globe, Keyboard, LogIn, LogOut,
  Monitor, Moon, Palette, PawPrint, Settings2, Sparkles, Sun, UserRound, Wallet
} from "lucide-react";
import { LANGUAGES } from "../lib/i18n";
import type { LanguagePref } from "../lib/i18n";
import type { ThemePref } from "../lib/storage";

export type UserMenuAction =
  | { type: "settings"; section?: string }
  | { type: "studio"; tab: string }
  | { type: "logout" }
  | { type: "download" }
  | { type: "pet" };

type Props = {
  t: (text: string) => string;
  collapsed: boolean;
  name: string;
  email: string | null;
  plan: string;
  authenticated: boolean;
  accountsEnabled: boolean;
  unread: number;
  languagePref: LanguagePref;
  onLanguagePref: (pref: LanguagePref) => void;
  themePref: ThemePref;
  onThemePref: (pref: ThemePref) => void;
  onAction: (action: UserMenuAction) => void;
  petOn?: boolean;
  /** The server's operator (owner / developer options): sees the server-wide billing dashboard. */
  operator?: boolean;
  /** The team service is on. */
  team?: boolean;
};

function initials(name: string): string {
  const clean = name.trim();
  if (!clean) return "C";
  const ascii = clean.split(/\s+/).filter(Boolean);
  if (/^[\x00-\x7f]+$/.test(clean) && ascii.length > 1) return (ascii[0][0] + ascii[1][0]).toUpperCase();
  return Array.from(clean)[0].toUpperCase();
}

function Row({ icon, label, hint, onClick, children, danger }: {
  icon: ReactNode; label: string; hint?: string; onClick?: () => void; children?: ReactNode; danger?: boolean;
}) {
  return <button type="button" role="menuitem" className={danger ? "um-item um-item--danger" : "um-item"} onClick={onClick}>
    <span className="um-item-icon">{icon}</span><span className="um-item-label">{label}</span>
    {hint && <kbd className="um-item-hint">{hint}</kbd>}{children}
  </button>;
}

/** ChatGPT / Claude style profile button pinned to the bottom of the sidebar. */
export default function UserMenu(props: Props) {
  const { t, collapsed, name, email, plan, authenticated, accountsEnabled, unread, languagePref, themePref, onAction, petOn, operator = false, team = false } = props;
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<"language" | "theme" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? "⌘" : "Ctrl";

  useEffect(() => {
    if (!open) { setSub(null); return; }
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const esc = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  function run(action: UserMenuAction) { setOpen(false); onAction(action); }
  const languages: [LanguagePref, string][] = [["system", t("跟随系统")], ...LANGUAGES.map((l): [LanguagePref, string] => [l.id, l.label])];
  const themes: [ThemePref, string, ReactNode][] = [
    ["light", t("浅色"), <Sun size={15} key="l"/>], ["dark", t("深色"), <Moon size={15} key="d"/>],
    ["system", t("跟随系统"), <Monitor size={15} key="s"/>]
  ];
  const currentLanguage = languages.find(([id]) => id === languagePref)?.[1] ?? "";
  const currentTheme = themes.find(([id]) => id === themePref)?.[1] ?? "";

  return <div className={collapsed ? "um-root um-root--collapsed" : "um-root"} ref={rootRef}>
    {open && <div className="um-menu" role="menu" aria-label={t("账户菜单")}>
      <div className="um-identity">
        <span className="um-avatar um-avatar--lg">{initials(name)}</span>
        <span className="um-identity-copy"><strong>{name}</strong><small>{email || t("未登录 · 注册后额度和记录多端互通")}</small></span>
      </div>
      <div className="um-sep"/>
      <Row icon={<Settings2 size={16}/>} label={t("设置")} hint={mod + " ,"} onClick={() => run({ type: "settings", section: "general" })}/>
      <Row icon={<Sparkles size={16}/>} label={t("个性化")} onClick={() => run({ type: "settings", section: "instructions" })}/>
      <Row icon={<PawPrint size={16}/>} label={t("桌宠")} onClick={() => run({ type: "pet" })}>
        <span className="um-item-value">{petOn ? t("已开启") : t("已关闭")}</span></Row>
      <div className="um-sub-wrap" onMouseEnter={() => setSub("language")} onMouseLeave={() => setSub((s) => s === "language" ? null : s)}>
        <Row icon={<Globe size={16}/>} label={t("语言")} onClick={() => setSub("language")}>
          <span className="um-item-value">{currentLanguage}</span><ChevronRight size={14} className="um-item-chev"/>
        </Row>
        {sub === "language" && <div className="um-submenu" role="menu" aria-label={t("语言")}>
          {languages.map(([id, label]) => <button type="button" role="menuitemradio" aria-checked={languagePref === id} key={id}
            className="um-item" onClick={() => { props.onLanguagePref(id); setSub(null); }}>
            <span className="um-item-label">{label}</span>{languagePref === id && <Check size={15} className="um-check"/>}</button>)}
        </div>}
      </div>
      <div className="um-sub-wrap" onMouseEnter={() => setSub("theme")} onMouseLeave={() => setSub((s) => s === "theme" ? null : s)}>
        <Row icon={<Palette size={16}/>} label={t("主题")} onClick={() => setSub("theme")}>
          <span className="um-item-value">{currentTheme}</span><ChevronRight size={14} className="um-item-chev"/>
        </Row>
        {sub === "theme" && <div className="um-submenu" role="menu" aria-label={t("主题")}>
          {themes.map(([id, label, icon]) => <button type="button" role="menuitemradio" aria-checked={themePref === id} key={id}
            className="um-item" onClick={() => { props.onThemePref(id); setSub(null); }}>
            <span className="um-item-icon">{icon}</span><span className="um-item-label">{label}</span>
            {themePref === id && <Check size={15} className="um-check"/>}</button>)}
          <button type="button" role="menuitem" className="um-item" onClick={() => run({ type: "settings", section: "appearance" })}>
            <span className="um-item-icon"><Palette size={15}/></span><span className="um-item-label">{t("背景与外观…")}</span></button>
        </div>}
      </div>
      <div className="um-sep"/>
      <Row icon={<UserRound size={16}/>} label={t("账户与安全")} onClick={() => run({ type: "studio", tab: "account" })}/>
      <Row icon={<Bell size={16}/>} label={t("通知中心")} onClick={() => run({ type: "studio", tab: "notifications" })}>
        {unread > 0 && <span className="um-count">{unread > 99 ? "99+" : unread}</span>}
      </Row>
      {accountsEnabled && authenticated && <Row icon={<Sparkles size={16}/>} label={t("CWU 额度")} onClick={() => run({ type: "settings", section: "cwu" })}/>}
      {operator ? <Row icon={<Wallet size={16}/>} label={t("账单与用量")} onClick={() => run({ type: "studio", tab: "billing" })}/>
        : <Row icon={<Wallet size={16}/>} label={t("订阅与账单")} onClick={() => run({ type: "studio", tab: "subscription" })}/>}
      {(operator || team) && <Row icon={<Users size={16}/>} label={t("团队")} onClick={() => run({ type: "settings", section: "team" })}/>}
      <Row icon={<Cloud size={16}/>} label={t("跨设备同步")} onClick={() => run({ type: "studio", tab: "sync" })}/>
      <div className="um-sep"/>
      <Row icon={<Keyboard size={16}/>} label={t("键盘快捷键")} hint={mod + " /"} onClick={() => run({ type: "settings", section: "shortcuts" })}/>
      <Row icon={<CircleHelp size={16}/>} label={t("帮助与关于")} onClick={() => run({ type: "settings", section: "about" })}/>
      <Row icon={<Download size={16}/>} label={t("下载桌面客户端")} onClick={() => run({ type: "download" })}/>
      {/* Always offered: a server without accounts explains it on the account page instead of a "local mode". */}
      <div className="um-sep"/>
      {accountsEnabled && authenticated
        ? <Row icon={<LogOut size={16}/>} label={t("退出登录")} danger onClick={() => run({ type: "logout" })}/>
        : <Row icon={<LogIn size={16}/>} label={t("注册 / 登录")} onClick={() => run({ type: "studio", tab: "account" })}/>}
    </div>}
    <button type="button" className={open ? "um-trigger um-trigger--open" : "um-trigger"} onClick={() => setOpen((v) => !v)}
      aria-haspopup="menu" aria-expanded={open} aria-label={t("打开账户菜单")} title={collapsed ? name : undefined}>
      <span className="um-avatar">{initials(name)}{unread > 0 && <span className="um-dot"/>}</span>
      <span className="um-trigger-copy"><strong>{name}</strong><small>{plan}</small></span>
      <ChevronsUpDown size={15} className="um-trigger-chev"/>
    </button>
  </div>;
}
