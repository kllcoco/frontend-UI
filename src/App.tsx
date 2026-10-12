import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, DragEvent, KeyboardEvent as ReactKeyboardEvent, CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowDownToLine, ArrowUp, Blocks, BrainCircuit, Check, ChevronDown, ChevronRight, Code2, Copy, FileText,
  GitBranch, Layers, LayoutGrid, Lightbulb, Menu, MoreHorizontal, Paperclip, PanelLeftClose,
  PanelLeftOpen, Pencil, Pin, PinOff, Plus, PlugZap, RotateCcw, Search, Settings2, Sparkles, Square, SquarePen,
  Target, Trash2, Workflow, X, ListChecks, Keyboard, Cloud, FolderOpen, FolderPlus, FolderMinus, ArrowLeft, Ghost, Mic, ThumbsDown, ThumbsUp, Volume2, VolumeX
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getApiStatus, streamChat } from "./lib/api";
import { loadCustomInstructions, saveCustomInstructions } from "./lib/instructions";
import {
  loadActiveId, loadConversations, loadThemePref, newId, saveActiveId, saveConversations, saveThemePref, systemTheme
} from "./lib/storage";
import type { ThemePref } from "./lib/storage";
import type { ApiStatus, ChatMessage, Conversation } from "./types";
import WorkbenchCenter from "./WorkbenchCenter";
import AccountCenter from "./AccountCenter";
import StudioCenter from "./StudioCenter";
import type { StudioTab } from "./lib/studio-api";
import { startAutoSync, stopAutoSync, queueAutoSync } from "./lib/cloud-sync";
import type { SyncPayload } from "./lib/cloud-sync";
import { accountApi, getAccountSession, invalidateAccountSession } from "./lib/account-api";
import type { AccountTab, SessionSnapshot } from "./lib/account-api";
import { workbenchApi } from "./lib/workbench-api";
import type { AgentMode, WorkbenchTab } from "./lib/workbench-api";
import CiroMark from "./components/CiroMark";
import SettingsCenter from "./SettingsCenter";
import ThinkingDepth from "./components/ThinkingDepth";
import UserMenu from "./components/UserMenu";
import type { UserMenuAction } from "./components/UserMenu";
import SearchPalette from "./components/SearchPalette";
import type { PaletteCommand } from "./components/SearchPalette";
import { backgroundUrl, loadAppearance, loadCustomWallpaper, removeCustomWallpaper, saveAppearance, saveCustomWallpaper } from "./lib/appearance";
import { loadChatPreferences, saveChatPreferences } from "./lib/preferences";
import { loadLanguagePref, resolveLanguage, saveLanguagePref, translate, previewText } from "./lib/i18n";
import type { Language, LanguagePref } from "./lib/i18n";
import { loadThinkingLevel, reasoningRequest, saveThinkingLevel, THINKING_LEVELS } from "./lib/thinking";
import { loadProfile, saveProfile } from "./lib/profile";
import { desktop, openExternal, RELEASES_URL } from "./lib/desktop";
import { createProject, loadProjects, projectContext, saveProjects } from "./lib/projects";
import type { Project } from "./lib/projects";
import ProjectView from "./components/ProjectView";
import CodeBlock from "./components/CodeBlock";
import { speechInputSupported, speechOutputSupported, useDictation, useReadAloud } from "./lib/speech";

type Attachment = { id: string; name: string; content: string };
const PREVIEW: ApiStatus = { configured: false, model: "ciro", models: ["ciro"], mode: "preview" };
const ACCOUNT_TABS = ["account", "subscription", "api-keys", "spending", "notifications", "memory", "sync"];
const STUDIO_TABS = ["studio", "thinking", "ide", "knowledge", "research", "media", "compute", "library", "marketplace", "devices"];
const prompts: { title: string; detail: string; prompt: string; icon: LucideIcon; tint: string }[] = [
  { title: "理清一个复杂问题", detail: "找到关键变量与下一步",
    prompt: "帮我系统分析这个问题：请先列出关键假设、未知变量和验证步骤。", icon: BrainCircuit, tint: "mint" },
  { title: "一起写点代码", detail: "从思路到可运行实现",
    prompt: "请帮我设计一个可靠的软件模块，先明确需求、接口和测试方案。", icon: Code2, tint: "lavender" },
  { title: "提炼文章与资料", detail: "把信息整理成洞见",
    prompt: "请帮我总结一篇文章的核心观点、证据和可执行启发。", icon: FileText, tint: "peach" },
  { title: "探索新的想法", detail: "让灵感更进一步",
    prompt: "和我一起头脑风暴，提出几个有新意、可验证的研究方向。", icon: Lightbulb, tint: "blue" }
];
const SLASH_COMMANDS: [string, string][] = [
  ["/goal", "目标模式：交给代理自主完成"], ["/plan", "计划模式：只规划不执行"], ["/studio", "打开融合工作台"],
  ["/work", "打开协作空间"], ["/plugins", "插件中心"], ["/ide", "代码工作区"], ["/research", "研究工作台"],
  ["/knowledge", "知识与文件"], ["/github", "GitHub 仓库"], ["/schedule", "定时任务"], ["/skills", "技能中心"],
  ["/apps", "官方应用"], ["/billing", "账单与用量"], ["/account", "账户与安全"], ["/memory", "记忆管理"],
  ["/sync", "跨设备同步"], ["/help", "显示所有命令"]
];

const acceptedExtensions = /\.(txt|md|markdown|json|csv|ts|tsx|js|jsx|mjs|cjs|py|html|css|scss|xml|yaml|yml|toml|ini|sql|log|sh|ps1|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|vue|svelte)$/i;
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

function dateGroup(time: number) {
  const now = new Date();
  const target = new Date(time);
  if (now.toDateString() === target.toDateString()) return "今天";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (yesterday.toDateString() === target.toDateString()) return "昨天";
  if (now.getTime() - time < 7 * 86_400_000) return "过去 7 天";
  if (now.getTime() - time < 30 * 86_400_000) return "过去 30 天";
  return "更早";
}

function formatTitle(raw: string) {
  const firstLine = raw.replace(/\s+/g, " ").trim();
  return firstLine.slice(0, 30) || "新的对话";
}

function fileSafeName(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 70) || "ciro-chat";
}

function greeting(language: Language) {
  const hour = new Date().getHours();
  const zh = hour < 6 ? "夜深了" : hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
  return translate(language, zh);
}

function exportMarkdown(chat: Conversation, language: Language) {
  const body = ["# " + chat.title, "", translate(language, "导出自 Ciro · ") + new Date().toLocaleString(language === "en" ? "en-US" : "zh-CN"), ""];
  chat.messages.forEach((message) => {
    body.push("## " + (message.role === "user" ? translate(language, "你") : message.preview ? translate(language, "客户端提示（非模型输出）") : "Ciro"));
    body.push("", message.content, "");
  });
  const blob = new Blob([body.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileSafeName(chat.title) + ".md";
  a.click();
  URL.revokeObjectURL(url);
}

function loadFlag(key: string, fallback: boolean) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v === "true"; } catch { return fallback; }
}
function saveFlag(key: string, value: boolean) {
  try { localStorage.setItem(key, String(value)); } catch { /* optional */ }
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const conversationsRef = useRef(conversations);
  const [activeId, setActiveId] = useState<string | null>(loadActiveId);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [status, setStatus] = useState<ApiStatus>(PREVIEW);
  const [statusLoading, setStatusLoading] = useState(true);
  const [model, setModel] = useState("ciro");
  const [studioOpen, setStudioOpen] = useState(() => ["studio", "plugins"].includes(new URLSearchParams(window.location.search).get("view") || ""));
  const [studioTab, setStudioTab] = useState<WorkbenchTab>(() => {
    const view = new URLSearchParams(window.location.search).get("view");
    return view === "studio" ? "studio" : view === "plugins" ? "plugins" : "goals";
  });
  const [composerMode, setComposerMode] = useState<"chat" | AgentMode>("chat");
  const [thinkingLevel, setThinkingLevel] = useState(loadThinkingLevel);
  const [themePref, setThemePref] = useState<ThemePref>(loadThemePref);
  const [systemDark, setSystemDark] = useState(() => systemTheme() === "dark");
  const theme: "light" | "dark" = themePref === "system" ? (systemDark ? "dark" : "light") : themePref;
  const [languagePref, setLanguagePref] = useState<LanguagePref>(loadLanguagePref);
  const [systemLangTick, setSystemLangTick] = useState(0);
  const language = useMemo(() => resolveLanguage(languagePref), [languagePref, systemLangTick]);
  const [appearance, setAppearance] = useState(loadAppearance);
  const [preferences, setPreferences] = useState(loadChatPreferences);
  const [instructions, setInstructions] = useState(loadCustomInstructions);
  const [profile, setProfile] = useState(loadProfile);
  const [projects, setProjects] = useState<Project[]>(loadProjects);
  const [projectViewId, setProjectViewId] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectDraft, setProjectDraft] = useState("");
  const [moveMenuId, setMoveMenuId] = useState<string | null>(null);
  const [temporaryMode, setTemporaryMode] = useState(false);
  const canDictate = useMemo(speechInputSupported, []);
  const canSpeak = useMemo(speechOutputSupported, []);
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [unread, setUnread] = useState(0);
  const [customImageUrl, setCustomImageUrl] = useState<string | null>(null);
  const customUrlRef = useRef<string | null>(null);
  const t = useCallback((text: string) => translate(language, text), [language]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => loadFlag("ciro.sidebar-collapsed.v1", false));
  const [moreOpen, setMoreOpen] = useState(() => loadFlag("ciro.sidebar-more.v1", false));
  const [settingsSection, setSettingsSection] = useState<string | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [openThoughts, setOpenThoughts] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [atBottom, setAtBottom] = useState(true);

  const cloudRef = useRef<SyncPayload>({
    conversations, activeId, preferences: { theme, language, instructions, appearance, chat: preferences }
  });
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const plusRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const notify = useCallback((text: string) => setToast(translate(language, text)), [language]);

  const current = conversations.find((item) => item.id === activeId);
  const dictation = useDictation(language, (text) => {
    setDraft((before) => (before && !/\s$/.test(before) ? before + (language === "en" ? " " : "") : before) + text.trim());
    focusComposer();
  }, (code) => notify(code === "not-allowed" ? "麦克风权限被拒绝" : "语音输入不可用"));
  const readAloud = useReadAloud(language);
  const sorted = useMemo(() => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt), [conversations]);
  const projectIds = useMemo(() => new Set(projects.map((p) => p.id)), [projects]);
  const inProject = (chat: Conversation) => Boolean(chat.projectId && projectIds.has(chat.projectId));
  const pinned = sorted.filter((chat) => chat.pinned && !chat.temporary);
  const grouped = ["今天", "昨天", "过去 7 天", "过去 30 天", "更早"].map((label) => ({
    label, chats: sorted.filter((chat) => !chat.pinned && !chat.temporary && !inProject(chat) && dateGroup(chat.updatedAt) === label)
  })).filter((item) => item.chats.length > 0);
  const viewProject = projects.find((p) => p.id === projectViewId);
  const currentProject = current?.projectId ? projects.find((p) => p.id === current.projectId) : undefined;
  const activeProject = current ? currentProject : viewProject;
  const displayName = session?.user?.displayName || profile.displayName || t("本地访客");
  const plan = session?.enabled ? (session.authenticated ? t("Ciro 账户") : t("未登录")) : t("本地模式");

  async function refreshStatus() {
    setStatusLoading(true);
    try {
      const next = await getApiStatus();
      setStatus(next);
      setModel((before) => next.models.includes(before) ? before : next.model);
    } catch {
      setStatus(PREVIEW);
      setModel("ciro");
    } finally {
      setStatusLoading(false);
    }
  }
  async function refreshSession(force = false) {
    try {
      const next = await getAccountSession(force);
      setSession(next);
      if (next.enabled && next.authenticated) {
        const result = await accountApi<{ unread: number }>("/notifications");
        setUnread(Number(result.unread) || 0);
      } else setUnread(0);
    } catch { /* account service optional */ }
  }

  useEffect(() => { void refreshStatus(); void refreshSession(); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => { if (session?.authenticated) void refreshSession(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [session?.authenticated]);
  useEffect(() => {
    const handlers = {
      capture: () => cloudRef.current,
      onRemote: (remote: SyncPayload) => {
        setConversations(remote.conversations);
        setActiveId(remote.activeId);
        setThemePref(loadThemePref()); setLanguagePref(loadLanguagePref());
        setInstructions(loadCustomInstructions()); setAppearance(loadAppearance());
        setPreferences(loadChatPreferences());
      }
    };
    const restart = () => { void startAutoSync(handlers); };
    restart();
    window.addEventListener("ciro-sync-preference-changed", restart);
    return () => {
      window.removeEventListener("ciro-sync-preference-changed", restart);
      stopAutoSync();
    };
  }, []);
  useEffect(() => {
    cloudRef.current = { conversations: conversations.filter((c) => !c.temporary), activeId: current?.temporary ? null : activeId, preferences: { theme, language, instructions, appearance, chat: preferences } };
    queueAutoSync(cloudRef.current);
  }, [conversations, activeId, theme, language, instructions, appearance, preferences]);
  useEffect(() => {
    conversationsRef.current = conversations;
    if (!busy) { saveConversations(conversations); return; }
    const timer = window.setTimeout(() => saveConversations(conversations), 300);
    return () => window.clearTimeout(timer);
  }, [conversations, busy]);
  useEffect(() => {
    const flush = () => saveConversations(conversationsRef.current);
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, []);
  useEffect(() => { saveActiveId(activeId); }, [activeId]);
  useEffect(() => { saveCustomInstructions(instructions); }, [instructions]);
  useEffect(() => { saveProfile(profile); }, [profile]);
  useEffect(() => { saveProjects(projects); }, [projects]);
  useEffect(() => { saveThinkingLevel(thinkingLevel); }, [thinkingLevel]);
  useEffect(() => { saveFlag("ciro.sidebar-collapsed.v1", sidebarCollapsed); }, [sidebarCollapsed]);
  useEffect(() => { saveFlag("ciro.sidebar-more.v1", moreOpen); }, [moreOpen]);
  useEffect(() => {
    saveLanguagePref(languagePref);
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
    document.title = language === "en" ? "Ciro — Let every idea go further" : "Ciro — 让每一个想法，走得更远";
    desktop()?.setLanguage(language);
  }, [languagePref, language]);
  useEffect(() => {
    const onLanguage = () => setSystemLangTick((n) => n + 1);
    window.addEventListener("languagechange", onLanguage);
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onScheme = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media?.addEventListener?.("change", onScheme);
    return () => { window.removeEventListener("languagechange", onLanguage); media?.removeEventListener?.("change", onScheme); };
  }, []);
  useEffect(() => { saveAppearance(appearance); }, [appearance]);
  useEffect(() => {
    saveChatPreferences(preferences);
    document.documentElement.dataset.reduceMotion = preferences.reduceMotion ? "true" : "false";
  }, [preferences]);
  useEffect(() => {
    let active = true;
    loadCustomWallpaper().then((blob) => {
      if (!active || !blob) return;
      const url = URL.createObjectURL(blob);
      customUrlRef.current = url;
      setCustomImageUrl(url);
    }).catch(() => { /* Browser storage unavailable: built-in backgrounds still work. */ });
    return () => {
      active = false;
      if (customUrlRef.current) URL.revokeObjectURL(customUrlRef.current);
    };
  }, []);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#141a18" : "#ffffff");
    saveThemePref(themePref);
  }, [theme, themePref]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!atBottom && busy) return;
    endRef.current?.scrollIntoView({ block: "end", behavior: (busy || preferences.reduceMotion) ? "instant" : "smooth" });
  }, [activeId, current?.messages.at(-1)?.content, current?.messages.at(-1)?.reasoning, busy]);
  useEffect(() => {
    if (!plusOpen && !modelOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (plusOpen && !plusRef.current?.contains(target)) setPlusOpen(false);
      if (modelOpen && !modelRef.current?.contains(target)) setModelOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [plusOpen, modelOpen]);
  useEffect(() => {
    if (!rowMenuId) return;
    const close = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest(".cx-row-menu,.cx-row-more")) setRowMenuId(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [rowMenuId]);

  const runCommand = useCallback((command: string) => {
    if (command === "new-chat") createNew();
    else if (command === "search") setPaletteOpen(true);
    else if (command === "settings") setSettingsSection("general");
    else if (command === "shortcuts") setSettingsSection("shortcuts");
    else if (command === "about") setSettingsSection("about");
    else if (command === "toggle-sidebar") toggleSidebar();
    else if (command === "export-chat") {
      const chat = conversationsRef.current.find((c) => c.id === activeIdRef.current);
      if (chat) exportMarkdown(chat, language);
    }
  }, [language]);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  useEffect(() => desktop()?.onCommand(runCommand), [runCommand]);
  useEffect(() => {
    function shortcuts(event: globalThis.KeyboardEvent) {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) { if (event.key === "Escape" && busy) controllerRef.current?.abort(); return; }
      const key = event.key.toLowerCase();
      if (key === "k" && !event.shiftKey) { event.preventDefault(); setPaletteOpen((v) => !v); }
      else if (key === "o" && event.shiftKey) { event.preventDefault(); runCommand("new-chat"); }
      else if (key === "s" && event.shiftKey) { event.preventDefault(); runCommand("toggle-sidebar"); }
      else if (key === ",") { event.preventDefault(); runCommand("settings"); }
      else if (key === "/") { event.preventDefault(); runCommand("shortcuts"); }
    }
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [runCommand, busy]);
  useEffect(() => () => controllerRef.current?.abort(), []);

  function toggleSidebar() {
    if (window.matchMedia("(max-width: 760px)").matches) setSidebarOpen((v) => !v);
    else setSidebarCollapsed((v) => !v);
  }

  function patchMessage(conversationId: string, messageId: string, patch: Partial<ChatMessage>) {
    setConversations((old) => old.map((chat) => chat.id === conversationId
      ? { ...chat, messages: chat.messages.map((m) => m.id === messageId ? { ...m, ...patch } : m) }
      : chat
    ));
  }

  async function generateReply(conversationId: string, history: ChatMessage[], projectId?: string) {
    const assistantId = newId();
    const level = THINKING_LEVELS[thinkingLevel];
    const reply: ChatMessage = { id: assistantId, role: "assistant", content: "", createdAt: Date.now(),
      preview: !status.configured, depth: level?.id };
    setConversations((old) => old.map((chat) =>
      chat.id === conversationId ? { ...chat, messages: [...chat.messages, reply], updatedAt: Date.now() } : chat
    ));

    if (!status.configured) {
      patchMessage(conversationId, assistantId, { content: previewText(language) });
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setGeneratingId(conversationId);
    setAtBottom(true);
    let answer = "";
    let thought = "";
    const started = Date.now();
    let thoughtDone = false;
    try {
      await streamChat({
        model,
        instructions,
        reasoning: reasoningRequest(thinkingLevel, status),
        project: projectContext(projects.find((p) => p.id === projectId)),
        messages: history,
        signal: controller.signal,
        onReasoning: (text) => {
          thought += text;
          patchMessage(conversationId, assistantId, { reasoning: thought });
        },
        onDelta: (text) => {
          answer += text;
          const patch: Partial<ChatMessage> = { content: answer };
          if (thought && !thoughtDone) { thoughtDone = true; patch.thinkingMs = Date.now() - started; }
          patchMessage(conversationId, assistantId, patch);
        }
      });
      if (!answer) throw new Error(t("接口未返回任何文本"));
    } catch (error) {
      if (controller.signal.aborted) {
        if (!answer) patchMessage(conversationId, assistantId, { content: t("生成已停止。") });
      } else {
        const message = error instanceof Error ? error.message : t("未知错误");
        patchMessage(conversationId, assistantId, {
          content: (answer ? answer + "\n\n---\n\n" : "") + "⚠️ " + t("生成中断：") + message });
        notify("请求失败，请检查 CIRO 后端");
      }
    } finally {
      if (thought && !thoughtDone) patchMessage(conversationId, assistantId, { thinkingMs: Date.now() - started });
      controllerRef.current = null;
      setGeneratingId(null);
      setBusy(false);
    }
  }

  function focusComposer() { window.setTimeout(() => composerRef.current?.focus(), 0); }
  function purgeTemporary(keepId?: string) {
    setConversations((old) => old.some((c) => c.temporary && c.id !== keepId) ? old.filter((c) => !c.temporary || c.id === keepId) : old);
  }

  function createNew() {
    purgeTemporary();
    setStudioOpen(false);
    setProjectViewId(null);
    setComposerMode("chat");
    setActiveId(null);
    setDraft("");
    setAttachments([]);
    setModelOpen(false);
    setRowMenuId(null);
    setSidebarOpen(false);
    setEditingId(null);
    focusComposer();
  }

  function selectChat(id: string) {
    purgeTemporary(id);
    setStudioOpen(false);
    setProjectViewId(null);
    setComposerMode("chat");
    setActiveId(id);
    setSidebarOpen(false);
    setRowMenuId(null);
    setModelOpen(false);
    setEditingId(null);
    setAtBottom(true);
  }

  function openProject(id: string) {
    purgeTemporary();
    setTemporaryMode(false);
    setStudioOpen(false);
    setActiveId(null);
    setProjectViewId(id);
    setSidebarOpen(false);
    setRowMenuId(null);
    setComposerMode("chat");
    focusComposer();
  }
  function commitNewProject() {
    const name = projectDraft.trim();
    setCreatingProject(false);
    setProjectDraft("");
    if (!name) return;
    const project = createProject(name, projects.length);
    setProjects((old) => [project, ...old]);
    openProject(project.id);
    notify("项目已创建");
  }
  function deleteProject(id: string) {
    setProjects((old) => old.filter((p) => p.id !== id));
    setConversations((old) => old.map((c) => c.projectId === id ? { ...c, projectId: undefined } : c));
    setProjectViewId(null);
    notify("项目已删除");
  }
  function moveChat(chat: Conversation, projectId: string | undefined) {
    setRowMenuId(null);
    setMoveMenuId(null);
    setConversations((old) => old.map((c) => c.id === chat.id ? { ...c, projectId } : c));
    notify(projectId ? "已移动到项目" : "已移出项目");
  }

  function openStudio(tab: WorkbenchTab = "goals") {
    purgeTemporary();
    setProjectViewId(null);
    setStudioTab(tab);
    setStudioOpen(true);
    setSidebarOpen(false);
    setRowMenuId(null);
  }
  async function sendGoal(goal: string, mode: AgentMode) {
    if (!goal.trim()) { setComposerMode(mode); return; }
    setBusy(true);
    try {
      await workbenchApi("/goals", { title: goal.trim().slice(0, 85), goal, mode });
      setDraft("");
      setAttachments([]);
      setComposerMode("chat");
      openStudio("goals");
    } catch (error) {
      setToast(error instanceof Error ? error.message : t("无法加载工作台"));
    } finally { setBusy(false); }
  }
  function handleSlash(text: string): boolean {
    const match = /^\/(goal|plan|work|agent|github|schedule|plugins|permissions|billing|apps|skills|account|subscription|keys|spending|notifications|memory|sync|studio|think|ide|knowledge|research|media|compute|library|market|devices|help)(?:\s+([\s\S]*))?$/i.exec(text);
    if (!match) return false;
    const command = match[1].toLowerCase();
    const argument = (match[2] || "").trim();
    if (command === "goal" || command === "plan") {
      setComposerMode(command === "goal" ? "goal" : "plan");
      setDraft(argument);
      if (argument) void sendGoal(argument, command === "goal" ? "goal" : "plan");
      return true;
    }
    if (command === "help") {
      setDraft("/");
      focusComposer();
      return true;
    }
    const tab: WorkbenchTab = command === "github" ? "github" : command === "schedule" ? "schedules" :
      command === "plugins" ? "plugins" : command === "permissions" ? "permissions" :
      command === "billing" ? "billing" : command === "apps" ? "apps" : command === "skills" ? "skills" :
      command === "account" ? "account" : command === "subscription" ? "subscription" : command === "keys" ? "api-keys" :
      command === "spending" ? "spending" : command === "notifications" ? "notifications" :
      command === "memory" ? "memory" : command === "sync" ? "sync" :
      command === "studio" ? "studio" : command === "think" ? "thinking" :
      command === "ide" ? "ide" : command === "knowledge" ? "knowledge" :
      command === "research" ? "research" : command === "media" ? "media" :
      command === "compute" ? "compute" : command === "library" ? "library" :
      command === "market" ? "marketplace" : command === "devices" ? "devices" : "goals";
    openStudio(tab);
    setDraft("");
    return true;
  }
  function sendMessage(textOverride?: string) {
    if (busy) return;
    const text = (textOverride ?? draft).trim();
    if (!text && attachments.length === 0) return;
    if (handleSlash(text)) return;
    if (composerMode !== "chat") {
      const extras = attachments.map(item => "\n\nAttachment: " + item.name + "\n" + item.content).join("");
      void sendGoal(text + extras, composerMode);
      return;
    }

    const attachmentText = attachments.map((file) =>
      t("附件：") + file.name + "\n\n```text\n" + file.content + "\n```"
    ).join("\n\n");
    const content = [text, attachmentText].filter(Boolean).join("\n\n---\n\n");
    const now = Date.now();
    const user: ChatMessage = { id: newId(), role: "user", content, createdAt: now };
    const conversationId = current?.id ?? newId();
    const history = [...(current?.messages || []), user];

    if (current) {
      setConversations((prev) => prev.map((chat) => chat.id === conversationId
        ? { ...chat, messages: [...chat.messages, user], updatedAt: now } : chat));
    } else {
      setConversations((prev) => [{
        id: conversationId,
        ...(viewProject ? { projectId: viewProject.id } : {}),
        ...(temporaryMode && !viewProject ? { temporary: true } : {}),
        title: formatTitle(text || attachments[0]?.name || t("新的对话")),
        createdAt: now,
        updatedAt: now,
        messages: [user]
      }, ...prev]);
    }
    const projectId = current ? current.projectId : viewProject?.id;
    setActiveId(conversationId);
    setProjectViewId(null);
    setDraft("");
    setAttachments([]);
    setSidebarOpen(false);
    if (composerRef.current) composerRef.current.style.height = "auto";
    void generateReply(conversationId, history, projectId);
  }

  function regenerate() {
    if (busy || !current) return;
    const lastUser = [...current.messages].reverse().findIndex((message) => message.role === "user");
    if (lastUser < 0) return;
    const end = current.messages.length - lastUser;
    const history = current.messages.slice(0, end);
    setConversations((prev) => prev.map((chat) =>
      chat.id === current.id ? { ...chat, messages: history, updatedAt: Date.now() } : chat
    ));
    void generateReply(current.id, history, current.projectId);
  }

  function submitEdit(message: ChatMessage) {
    if (!current || busy) return;
    const text = editValue.trim();
    setEditingId(null);
    if (!text || text === message.content) return;
    const index = current.messages.findIndex((m) => m.id === message.id);
    if (index < 0) return;
    const edited: ChatMessage = { ...message, id: newId(), content: text, createdAt: Date.now() };
    const history = [...current.messages.slice(0, index), edited];
    setConversations((prev) => prev.map((chat) => chat.id === current.id ? { ...chat, messages: history, updatedAt: Date.now() } : chat));
    void generateReply(current.id, history, current.projectId);
  }

  function startRename(chat: Conversation) {
    setRowMenuId(null);
    setRenamingId(chat.id);
    setRenameValue(chat.title);
  }
  function commitRename() {
    const id = renamingId;
    setRenamingId(null);
    const value = renameValue.trim();
    if (!id || !value) return;
    setConversations((prev) => prev.map((item) => item.id === id ? { ...item, title: value.slice(0, 80) } : item));
  }
  function togglePin(chat: Conversation) {
    setRowMenuId(null);
    setConversations((prev) => prev.map((item) => item.id === chat.id ? { ...item, pinned: !item.pinned } : item));
    notify(chat.pinned ? "已取消置顶" : "已置顶");
  }

  function deleteChat(chat: Conversation) {
    setRowMenuId(null);
    if (!window.confirm(t("确定删除“") + chat.title + t("”？此操作无法撤销。"))) return;
    if (generatingId === chat.id) controllerRef.current?.abort();
    setConversations((prev) => prev.filter((item) => item.id !== chat.id));
    if (activeId === chat.id) setActiveId(null);
    notify("对话已删除");
  }

  function organizeChat(operation: "folder" | "branch" | "checkpoint" | "restore", id: string, value: string | number) {
    const source = conversations.find(c => c.id === id);
    if (!source) return;
    const now = Date.now();
    if (operation === "folder") {
      const folder = String(value).trim().slice(0, 60);
      setConversations(old => old.map(c => c.id === id ? { ...c, folder, updatedAt: now } : c));
      notify("已归档"); return;
    }
    if (operation === "checkpoint") {
      setConversations(old => old.map(c => c.id === id ? {
        ...c, checkpoints: [{ id: newId(), label: String(value).slice(0, 90), createdAt: now,
          messages: c.messages.map(m => ({ ...m })) }, ...(c.checkpoints || [])].slice(0, 10),
        updatedAt: now
      } : c));
      notify("创建检查点"); return;
    }
    if (operation === "restore") {
      const saved = source.checkpoints?.find(c => c.id === value);
      if (!saved) return;
      setConversations(old => old.map(c => c.id === id ? { ...c,
        messages: saved.messages.map(m => ({ ...m })), updatedAt: now } : c));
      notify("恢复此版本"); return;
    }
    const count = Number(value);
    if (!Number.isSafeInteger(count) || count < 1 || count > source.messages.length) return;
    const forkId = newId();
    const branch: Conversation = { id: forkId, parentId: source.id, folder: source.folder,
      title: source.title + " · " + t("分支"), createdAt: now, updatedAt: now,
      messages: source.messages.slice(0, count).map(m => ({ ...m, id: newId() })) };
    setConversations(old => [branch, ...old]); setActiveId(forkId); setStudioOpen(false);
    notify("创建分支");
  }

  function clearHistory() {
    if (!window.confirm(t("确定清空全部本地对话？此操作无法撤销。"))) return;
    controllerRef.current?.abort();
    setConversations([]);
    setActiveId(null);
    setSettingsSection(null);
    notify("本地对话已清空");
  }

  async function copyContent(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify("已复制到剪贴板");
    } catch {
      notify("复制失败，请检查浏览器权限");
    }
  }

  async function addFiles(selected: File[]) {
    if (!selected.length) return;
    if (attachments.length + selected.length > 3) {
      notify("一次最多选择 3 个文本附件");
      return;
    }
    if (selected.some((file) => !acceptedExtensions.test(file.name) || file.size > 80_000)) {
      notify("仅支持常见文本/代码文件，每个不超过 80 KB");
      return;
    }
    try {
      const items = await Promise.all(selected.map(async (file) => ({
        id: newId(), name: file.name, content: await file.text()
      })));
      setAttachments((before) => [...before, ...items].slice(0, 3));
      composerRef.current?.focus();
    } catch {
      notify("读取附件失败");
    }
  }
  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    void addFiles(selected);
  }
  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void addFiles(Array.from(event.dataTransfer.files || []));
  }
  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files || []);
    if (files.length) { event.preventDefault(); void addFiles(files); }
  }

  function onComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape" && composerMode !== "chat" && !draft) { setComposerMode("chat"); return; }
    if (event.key === "ArrowUp" && !draft && current && !busy) {
      const lastUser = [...current.messages].reverse().find((m) => m.role === "user");
      if (lastUser) { event.preventDefault(); setEditingId(lastUser.id); setEditValue(lastUser.content); }
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    const modified = event.ctrlKey || event.metaKey;
    if ((preferences.sendWithEnter && !modified) || (!preferences.sendWithEnter && modified)) {
      event.preventDefault();
      sendMessage();
    }
  }

  function choosePrompt(text: string) {
    setDraft(text);
    setSidebarOpen(false);
    focusComposer();
  }

  const readyLabel = statusLoading ? t("正在检查") : status.configured ? t("推理接口已配置") : t("界面预览模式");
  const showWallpaper = appearance.preset !== "white" && (appearance.scope === "all" || !current);
  const wallpaperStyle: CSSProperties = {
    backgroundImage: "url('" + backgroundUrl(appearance.preset, customImageUrl) + "')",
    filter: "blur(" + appearance.blur + "px) brightness(" + appearance.brightness + "%)"
  };
  async function uploadWallpaper(file: File) {
    await saveCustomWallpaper(file);
    const url = URL.createObjectURL(file);
    if (customUrlRef.current) URL.revokeObjectURL(customUrlRef.current);
    customUrlRef.current = url;
    setCustomImageUrl(url);
    setAppearance((old) => ({ ...old, preset: "custom" }));
    notify("自定义背景已保存到此设备");
  }
  async function removeWallpaper() {
    await removeCustomWallpaper();
    if (customUrlRef.current) URL.revokeObjectURL(customUrlRef.current);
    customUrlRef.current = null;
    setCustomImageUrl(null);
    setAppearance((old) => ({ ...old, preset: old.preset === "custom" ? "white" : old.preset }));
    notify("已删除自定义背景");
  }
  function exportAllConversations() {
    const blob = new Blob([JSON.stringify({
      schema: "CIRO_CLIENT_CONVERSATIONS_V1", exportedAt: new Date().toISOString(), conversations
    }, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ciro-conversations-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("全部对话已导出");
  }
  async function logout() {
    try {
      await accountApi("/logout", "POST");
      invalidateAccountSession();
      await refreshSession(true);
      notify("已退出登录");
    } catch (error) {
      setToast(error instanceof Error ? error.message : t("退出失败"));
    }
  }
  function onUserMenu(action: UserMenuAction) {
    if (action.type === "settings") setSettingsSection(action.section || "general");
    else if (action.type === "studio") openStudio(action.tab as WorkbenchTab);
    else if (action.type === "logout") void logout();
    else if (action.type === "download") openExternal(RELEASES_URL);
  }

  const paletteCommands: PaletteCommand[] = [
    { id: "new", label: t("开启新对话"), icon: <SquarePen size={16}/>, hint: MOD + " ⇧ O", run: createNew },
    { id: "project", label: t("新建项目"), icon: <FolderPlus size={16}/>, run: () => { setSidebarCollapsed(false); setSidebarOpen(true); setCreatingProject(true); } },
    ...projects.map((p) => ({ id: "project:" + p.id, label: t("项目") + " · " + p.name, icon: <FolderOpen size={16}/>, run: () => openProject(p.id) })),
    { id: "studio", label: t("融合工作台"), icon: <Layers size={16}/>, run: () => openStudio("studio") },
    { id: "work", label: t("协作空间"), icon: <Workflow size={16}/>, run: () => openStudio("goals") },
    { id: "plugins", label: t("插件中心"), icon: <PlugZap size={16}/>, run: () => openStudio("plugins") },
    { id: "ide", label: t("代码工作区"), icon: <Code2 size={16}/>, run: () => openStudio("ide") },
    { id: "settings", label: t("设置"), icon: <Settings2 size={16}/>, hint: MOD + " ,", run: () => setSettingsSection("general") },
    { id: "shortcuts", label: t("键盘快捷键"), icon: <Keyboard size={16}/>, hint: MOD + " /", run: () => setSettingsSection("shortcuts") },
    { id: "sync", label: t("跨设备同步"), icon: <Cloud size={16}/>, run: () => openStudio("sync") }
  ];

  const navItems: { tab: WorkbenchTab; label: string; icon: LucideIcon }[] = [
    { tab: "studio", label: "融合工作台", icon: Layers },
    { tab: "goals", label: "协作空间", icon: Workflow },
    { tab: "plugins", label: "插件中心", icon: PlugZap }
  ];
  const moreItems: { tab: WorkbenchTab; label: string; icon: LucideIcon }[] = [
    { tab: "ide", label: "代码工作区", icon: Code2 },
    { tab: "research", label: "研究工作台", icon: Search },
    { tab: "knowledge", label: "知识与文件", icon: FileText },
    { tab: "apps", label: "官方应用", icon: LayoutGrid },
    { tab: "skills", label: "技能中心", icon: Blocks }
  ];
  const slashMatches = draft.startsWith("/") && !draft.includes(" ")
    ? SLASH_COMMANDS.filter(([cmd]) => cmd.startsWith(draft.toLowerCase())) : [];
  const thinkingNote = !status.configured ? t("预览模式：连接推理服务后生效")
    : status.reasoningModes?.includes("deep") ? t("由 CIRO 原生深度推理执行")
    : status.reasoningEffort ? t("以 reasoning_effort 传给模型服务") : t("当前模型服务未开启思考深度");

  function renderRow(chat: Conversation) {
    const active = activeId === chat.id && !studioOpen;
    return <div className={["cx-row", active ? "cx-row--active" : "", rowMenuId === chat.id ? "cx-row--menu" : ""].join(" ")} key={chat.id}>
      {renamingId === chat.id
        ? <input className="cx-rename" autoFocus value={renameValue} aria-label={t("重命名对话")}
          onChange={(e) => setRenameValue(e.target.value)} onBlur={commitRename}
          onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenamingId(null); }}/>
        : <button className="cx-row-main" title={chat.title} onClick={() => selectChat(chat.id)} onDoubleClick={() => startRename(chat)}>
          <span>{chat.title}</span>
          {generatingId === chat.id && <span className="cx-row-spinner" aria-label={t("正在生成")}/>}
        </button>}
      <button className="cx-row-more" onClick={() => { setMoveMenuId(null); setRowMenuId((id) => id === chat.id ? null : chat.id); }}
        aria-label={t("管理对话：") + chat.title} title={t("更多操作")}><MoreHorizontal size={16}/></button>
      {rowMenuId === chat.id && <div className="cx-row-menu" role="menu">
        <button role="menuitem" onClick={() => togglePin(chat)}>{chat.pinned ? <PinOff size={15}/> : <Pin size={15}/>} {t(chat.pinned ? "取消置顶" : "置顶")}</button>
        <button role="menuitem" onClick={() => startRename(chat)}><Pencil size={15}/> {t("重命名")}</button>
        <button role="menuitem" aria-expanded={moveMenuId === chat.id} onClick={() => setMoveMenuId((id) => id === chat.id ? null : chat.id)}>
          <FolderOpen size={15}/> {t("移动到项目")}<ChevronRight size={13} className={moveMenuId === chat.id ? "cx-chev cx-chev--open" : "cx-chev"} style={{ marginLeft: "auto" }}/></button>
        {moveMenuId === chat.id && <div className="cx-move-list">
          {projects.length === 0 && <span className="cx-move-empty">{t("还没有项目")}</span>}
          {projects.map((p) => <button role="menuitem" key={p.id} disabled={chat.projectId === p.id} onClick={() => moveChat(chat, p.id)}>
            <span className="cx-project-dot" style={{ background: p.color }}/>{p.name}</button>)}
          {chat.projectId && <button role="menuitem" onClick={() => moveChat(chat, undefined)}><FolderMinus size={15}/> {t("移出项目")}</button>}
          <button role="menuitem" onClick={() => { setRowMenuId(null); setMoveMenuId(null); setCreatingProject(true); }}><FolderPlus size={15}/> {t("新建项目")}</button>
        </div>}
        <button role="menuitem" onClick={() => { exportMarkdown(chat, language); setRowMenuId(null); notify("已导出 Markdown"); }}>
          <ArrowDownToLine size={15}/> {t("导出对话")}</button>
        <div className="cx-menu-sep"/>
        <button role="menuitem" className="danger" onClick={() => deleteChat(chat)}><Trash2 size={15}/> {t("删除对话")}</button>
      </div>}
    </div>;
  }

  return (
    <div className={["app-shell", "cx-shell", sidebarCollapsed ? "cx-shell--collapsed" : ""].join(" ")}>
      {sidebarOpen && <button className="mobile-scrim" onClick={() => setSidebarOpen(false)} aria-label={t("关闭侧栏")}/>}
      <aside className={["cx-sidebar", sidebarOpen ? "cx-sidebar--open" : "", sidebarCollapsed ? "cx-sidebar--collapsed" : ""].join(" ")}
        aria-label={t("侧栏")}>
        <div className="cx-brand">
          <button className="cx-brand-button" onClick={createNew} aria-label={t("Ciro 首页")}>
            <CiroMark small/><strong>Ciro</strong>
          </button>
          <button className="cx-icon cx-collapse" onClick={() => setSidebarCollapsed((v) => !v)}
            title={(sidebarCollapsed ? t("展开侧栏") : t("折叠侧栏")) + " (" + MOD + " ⇧ S)"}
            aria-label={sidebarCollapsed ? t("展开侧栏") : t("折叠侧栏")}>
            {sidebarCollapsed ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}
          </button>
          <button className="cx-icon cx-mobile-close" onClick={() => setSidebarOpen(false)} aria-label={t("关闭侧栏")}><X size={18}/></button>
        </div>

        <nav className="cx-nav" aria-label={t("主导航")}>
          <button className="cx-nav-item cx-new" onClick={createNew} title={t("新对话") + " (" + MOD + " ⇧ O)"} aria-label={t("新对话")}>
            <SquarePen size={17}/><span>{t("新对话")}</span><kbd>{MOD} ⇧ O</kbd>
          </button>
          <button className="cx-nav-item" onClick={() => setPaletteOpen(true)} title={t("搜索对话") + " (" + MOD + " K)"} aria-label={t("搜索对话")}>
            <Search size={17}/><span>{t("搜索对话")}</span><kbd>{MOD} K</kbd>
          </button>
          <div className="cx-nav-gap"/>
          {navItems.map(({ tab, label, icon: Icon }) =>
            <button key={tab} className={["cx-nav-item", studioOpen && studioTab === tab ? "cx-nav-item--active" : ""].join(" ")}
              onClick={() => openStudio(tab)} aria-label={t(label)} title={t(label)}>
              <Icon size={17}/><span>{t(label)}</span>
            </button>)}
          <button className="cx-nav-item cx-more-toggle" onClick={() => { setMoreOpen((v) => !v); if (sidebarCollapsed) setSidebarCollapsed(false); }}
            aria-expanded={moreOpen} title={t("更多工具")}>
            <LayoutGrid size={17}/><span>{t("更多工具")}</span>
            <ChevronRight size={14} className={moreOpen ? "cx-chev cx-chev--open" : "cx-chev"}/>
          </button>
          <div className={moreOpen && !sidebarCollapsed ? "cx-more cx-more--open" : "cx-more"}>
            <div className="cx-more-inner">
              {moreItems.map(({ tab, label, icon: Icon }) =>
                <button key={tab} tabIndex={moreOpen ? 0 : -1}
                  className={["cx-nav-item cx-nav-sub", studioOpen && studioTab === tab ? "cx-nav-item--active" : ""].join(" ")}
                  onClick={() => openStudio(tab)} aria-label={t(label)}>
                  <Icon size={16}/><span>{t(label)}</span>
                </button>)}
            </div>
          </div>
        </nav>

        <div className="cx-history">
          <div className="cx-group cx-projects">
            <div className="cx-group-label cx-group-label--action">
              <span>{t("项目")}</span>
              <button type="button" className="cx-group-add" onClick={() => { setCreatingProject(true); setSidebarCollapsed(false); }}
                aria-label={t("新建项目")} title={t("新建项目")}><Plus size={14}/></button>
            </div>
            {creatingProject && <input className="cx-rename cx-project-input" autoFocus value={projectDraft} placeholder={t("项目名称")}
              aria-label={t("项目名称")} maxLength={60} onChange={(e) => setProjectDraft(e.target.value)} onBlur={commitNewProject}
              onKeyDown={(e) => { if (e.key === "Enter") commitNewProject(); if (e.key === "Escape") { setCreatingProject(false); setProjectDraft(""); } }}/>}
            {projects.length === 0 && !creatingProject && <button type="button" className="cx-project-empty" onClick={() => setCreatingProject(true)}>
              <FolderPlus size={15}/><span>{t("新建项目，归类相关对话")}</span></button>}
            {projects.map((p) => {
              const count = conversations.filter((c) => c.projectId === p.id).length;
              const open = projectViewId === p.id || currentProject?.id === p.id;
              return <div key={p.id}>
                <button type="button" className={["cx-row-main cx-project-row", projectViewId === p.id && !studioOpen ? "cx-project-row--active" : ""].join(" ")}
                  onClick={() => openProject(p.id)} title={p.name}>
                  <FolderOpen size={15} style={{ color: p.color }}/><span>{p.name}</span>{count > 0 && <small>{count}</small>}
                </button>
                {open && sorted.filter((c) => c.projectId === p.id).slice(0, 8).map((chat) => <div className="cx-project-chats" key={chat.id}>{renderRow(chat)}</div>)}
              </div>;
            })}
          </div>
          {conversations.length === 0 && <div className="cx-history-empty">{t("还没有历史对话\n开始一次新的探索吧")}</div>}
          {pinned.length > 0 && <div className="cx-group"><div className="cx-group-label">{t("已置顶")}</div>{pinned.map(renderRow)}</div>}
          {grouped.map((group) => <div className="cx-group" key={group.label}>
            <div className="cx-group-label">{t(group.label)}</div>
            {group.chats.map(renderRow)}
          </div>)}
        </div>

        <UserMenu t={t} collapsed={sidebarCollapsed} name={displayName} email={session?.user?.email || null} plan={plan}
          authenticated={Boolean(session?.authenticated)} accountsEnabled={Boolean(session?.enabled)} unread={unread}
          languagePref={languagePref} onLanguagePref={(pref) => { setLanguagePref(pref); }}
          themePref={themePref} onThemePref={setThemePref} onAction={onUserMenu}/>
      </aside>

      {studioOpen ? <main className="workspace workspace--studio">
        <div className="wb-mobile-top"><button type="button" onClick={() => setSidebarOpen(true)} aria-label={t("打开侧栏")}><Menu size={19}/></button>
          <CiroMark small/><span>Ciro Studio</span></div>
        {sidebarCollapsed && <button className="cx-icon cx-float-expand" onClick={() => setSidebarCollapsed(false)} aria-label={t("展开侧栏")}><PanelLeftOpen size={18}/></button>}
        <div className="cx-studio-scroll" key={studioTab}>
          {ACCOUNT_TABS.includes(studioTab)
            ? <div className="acc-workspace"><AccountCenter key={studioTab} language={language} section={studioTab as AccountTab}/></div>
            : STUDIO_TABS.includes(studioTab)
              ? <div className="stu-workspace"><StudioCenter key={studioTab} language={language} section={studioTab as StudioTab}
                  conversations={conversations} onLibraryAction={organizeChat}
                  onNavigate={route => { if (route === "chat") createNew(); else openStudio(route as WorkbenchTab); }}/></div>
              : <WorkbenchCenter key={studioTab} language={language} initialTab={studioTab}
                onNavigate={route => { if (route === "chat") createNew(); else openStudio(route as WorkbenchTab); }}/>}
        </div>
      </main> : <main className={showWallpaper ? "workspace workspace--wallpaper" : "workspace"}
        data-font={preferences.fontSize} data-compact={preferences.compactMessages ? "true" : "false"}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
        onDrop={onDrop}>
        {showWallpaper && <>
          <div className="wallpaper-image" style={wallpaperStyle} aria-hidden="true"/>
          <div className="wallpaper-veil" style={{ backgroundColor: "rgba(2,12,11," + appearance.overlay / 100 + ")" }} aria-hidden="true"/>
        </>}
        {dragging && <div className="cx-dropzone"><Paperclip size={26}/><strong>{t("松开以添加附件")}</strong><span>{t("文本或代码文件，每个不超过 80 KB")}</span></div>}
        <header className="cx-topbar">
          <div className="cx-topbar-left">
            <button className="cx-icon cx-mobile-menu" onClick={() => setSidebarOpen(true)} aria-label={t("打开侧栏")}><Menu size={20}/></button>
            {sidebarCollapsed && <button className="cx-icon cx-desktop-expand" onClick={() => setSidebarCollapsed(false)} aria-label={t("展开侧栏")}>
              <PanelLeftOpen size={18}/></button>}
            {sidebarCollapsed && <button className="cx-icon cx-desktop-expand" onClick={createNew} aria-label={t("新对话")} title={t("新对话")}>
              <SquarePen size={18}/></button>}
            {activeProject && <button type="button" className="cx-crumb" onClick={() => current ? openProject(activeProject.id) : createNew()} title={current ? t("打开项目") : t("返回首页")}>
              {current ? <FolderOpen size={15} style={{ color: activeProject.color }}/> : <ArrowLeft size={15}/>}
              <span>{activeProject.name}</span><span className="cx-crumb-sep">/</span>
            </button>}
            <div className="cx-model" ref={modelRef}>
              <button className="cx-model-trigger" onClick={() => setModelOpen((value) => !value)}
                aria-expanded={modelOpen} aria-label={t("切换模型")}>
                <span>{model === "ciro" ? "Ciro" : model}</span>
                <ChevronDown size={16} className={modelOpen ? "cx-chev cx-chev--down-open" : "cx-chev"}/>
              </button>
              {modelOpen && <div className="cx-model-menu">
                <div className="cx-menu-caption">{t("可用模型")}</div>
                {(status.models.length ? status.models : ["ciro"]).map((item) => (
                  <button key={item} className="cx-model-option" onClick={() => { setModel(item); setModelOpen(false); }}>
                    <CiroMark small/>
                    <span><strong>{item === "ciro" ? "Ciro" : item}</strong><small>{status.configured ? t("由服务端提供") : t("等待推理接口接入")}</small></span>
                    {item === model && <Check size={16} className="cx-model-check"/>}
                  </button>
                ))}
                <div className="cx-menu-sep"/>
                <button className="cx-model-option cx-model-link" onClick={() => { setModelOpen(false); setSettingsSection("models"); }}>
                  <Settings2 size={16}/><span><strong>{t("模型与连接设置")}</strong></span></button>
              </div>}
            </div>
          </div>
          <div className="cx-topbar-right">
            <button type="button" className={["connection-label", status.configured ? "connection-label--ready" : ""].join(" ")}
              onClick={() => setSettingsSection("models")} title={readyLabel}>
              <span className="status-dot"/><span className="connection-text">{readyLabel}</span>
            </button>
            {(!current || current.temporary) && !viewProject && <button type="button"
              className={temporaryMode || current?.temporary ? "cx-temp cx-temp--on" : "cx-temp"} aria-pressed={temporaryMode}
              disabled={Boolean(current?.temporary)} onClick={() => { setTemporaryMode((v) => !v); notify(temporaryMode ? "已关闭临时对话" : "临时对话：不会保存到历史记录"); }}
              title={t("临时对话")} aria-label={t("临时对话")}><Ghost size={16}/><span>{t("临时")}</span></button>}
            {current && !current.temporary && <button className="cx-icon" title={t("导出本次对话")}
              onClick={() => { exportMarkdown(current, language); notify("已导出 Markdown"); }}
              aria-label={t("导出本次对话")}><ArrowDownToLine size={18}/></button>}
            <button className="cx-icon" onClick={() => setSettingsSection("appearance")} title={t("设置")} aria-label={t("设置")}><Settings2 size={18}/></button>
          </div>
        </header>

        <div ref={scrollRef} className={current ? "content-area content-area--chat" : viewProject ? "content-area content-area--project" : "content-area content-area--welcome"}
          onScroll={(e) => { const el = e.currentTarget; setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80); }}>
          {!current && viewProject ? (
            <ProjectView t={t} language={language} project={viewProject}
              chats={sorted.filter((c) => c.projectId === viewProject.id)}
              onChange={(next) => setProjects((old) => old.map((p) => p.id === next.id ? next : p))}
              onDelete={() => deleteProject(viewProject.id)} onOpenChat={selectChat} onNotify={notify}/>
          ) : !current ? (
            <section className="cx-welcome">
              <div className="cx-hero-mark"><CiroMark/></div>
              <p className="cx-greeting">{greeting(language)}{displayName !== t("本地访客") ? (language === "en" ? ", " : "，") + displayName : ""}</p>
              {temporaryMode ? <>
                <h1>{t("临时对话")}</h1>
                <p className="cx-temp-note">{t("此对话不会出现在历史记录中，也不会同步或用于记忆。离开后即删除。")}</p>
              </> : <h1>{t("让每一个想法，")}{language === "en" ? " " : ""}<em>{t("走得更远。")}</em></h1>}
            </section>
          ) : (
            <div className="messages" aria-live="polite">
              {current.messages.map((message, index) => {
                const assistant = message.role === "assistant";
                const lastAssistant = assistant && index === current.messages.length - 1;
                const isStreaming = busy && generatingId === current.id && lastAssistant;
                const thinking = isStreaming && !message.content;
                const body = message.preview ? previewText(language) : message.content;
                const thoughtOpen = openThoughts[message.id] ?? (isStreaming && !message.content);
                return <article key={message.id} className={["message", assistant ? "message--assistant" : "message--user"].join(" ")}>
                  {assistant && <div className="message-avatar"><CiroMark small/></div>}
                  <div className="message-body">
                    {assistant ? <>
                      {(message.reasoning || thinking) && <div className={thinking ? "cx-thought cx-thought--live" : "cx-thought"}>
                        <button type="button" className="cx-thought-head" onClick={() => setOpenThoughts((m) => ({ ...m, [message.id]: !thoughtOpen }))}
                          aria-expanded={thoughtOpen} disabled={!message.reasoning}>
                          <BrainCircuit size={15}/>
                          <span className={thinking ? "cx-shimmer" : ""}>{thinking ? t("正在思考…") :
                            message.thinkingMs ? t("已思考") + " " + Math.max(1, Math.round(message.thinkingMs / 1000)) + " " + t("秒") : t("思考过程")}</span>
                          {message.reasoning && <ChevronDown size={14} className={thoughtOpen ? "cx-chev cx-chev--down-open" : "cx-chev"}/>}
                        </button>
                        {thoughtOpen && message.reasoning && <div className="cx-thought-body">{message.reasoning}</div>}
                      </div>}
                      <div className={["message-prose", message.preview ? "message-prose--preview" : ""].join(" ")}>
                        {body ? <ReactMarkdown remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer"/>,
                            pre: ({ children }) => <CodeBlock copyLabel={t("复制代码")} copiedLabel={t("已复制")}>{children}</CodeBlock>
                          }}>{body}</ReactMarkdown> : null}
                        {isStreaming && message.content && <span className="typing-cursor" aria-label={t("正在生成")}/>}
                      </div>
                    </> : editingId === message.id ? (
                      <div className="cx-edit">
                        <textarea autoFocus value={editValue} aria-label={t("编辑消息")} rows={Math.min(10, editValue.split("\n").length + 1)}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setEditingId(null);
                            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submitEdit(message); }
                          }}/>
                        <div className="cx-edit-actions">
                          <button type="button" className="cx-btn" onClick={() => setEditingId(null)}>{t("取消")}</button>
                          <button type="button" className="cx-btn cx-btn--primary" onClick={() => submitEdit(message)} disabled={busy}>{t("发送")}</button>
                        </div>
                      </div>
                    ) : <div className="user-bubble">{message.content}</div>}
                    {preferences.showTime && <time className="message-time" dateTime={new Date(message.createdAt).toISOString()}>
                      {new Date(message.createdAt).toLocaleTimeString(language === "en" ? "en-US" : "zh-CN", { hour: "2-digit", minute: "2-digit" })}
                    </time>}
                    {assistant && message.content && !isStreaming && <div className="message-actions">
                      <button aria-label={t("复制回答")} title={t("复制回答")} onClick={() => void copyContent(body)}><Copy size={15}/></button>
                      {canSpeak && <button aria-label={readAloud.speakingId === message.id ? t("停止朗读") : t("朗读")} title={readAloud.speakingId === message.id ? t("停止朗读") : t("朗读")}
                        className={readAloud.speakingId === message.id ? "is-on" : ""} onClick={() => readAloud.toggle(message.id, body)}>
                        {readAloud.speakingId === message.id ? <VolumeX size={15}/> : <Volume2 size={15}/>}</button>}
                      {!message.preview && <>
                        <button aria-label={t("有帮助")} title={t("有帮助")} aria-pressed={message.feedback === "up"} className={message.feedback === "up" ? "is-on" : ""}
                          onClick={() => { patchMessage(current.id, message.id, { feedback: message.feedback === "up" ? undefined : "up" }); if (message.feedback !== "up") notify("感谢反馈"); }}><ThumbsUp size={15}/></button>
                        <button aria-label={t("没有帮助")} title={t("没有帮助")} aria-pressed={message.feedback === "down"} className={message.feedback === "down" ? "is-on" : ""}
                          onClick={() => { patchMessage(current.id, message.id, { feedback: message.feedback === "down" ? undefined : "down" }); if (message.feedback !== "down") notify("感谢反馈，我们会改进"); }}><ThumbsDown size={15}/></button>
                      </>}
                      {lastAssistant && <button aria-label={t("重新生成")} title={t("重新生成")} onClick={regenerate} disabled={busy}><RotateCcw size={15}/></button>}
                      <button aria-label={t("从这里创建分支")} title={t("从这里创建分支")} onClick={() => organizeChat("branch", current.id, index + 1)}><GitBranch size={15}/></button>
                      {message.preview && <span className="preview-tag">{t("界面提示 · 非 AI 输出")}</span>}
                    </div>}
                    {!assistant && editingId !== message.id && <div className="message-actions message-actions--user">
                      <button aria-label={t("复制消息")} title={t("复制消息")} onClick={() => void copyContent(message.content)}><Copy size={15}/></button>
                      <button aria-label={t("编辑消息")} title={t("编辑消息")} disabled={busy}
                        onClick={() => { setEditingId(message.id); setEditValue(message.content); }}><Pencil size={15}/></button>
                    </div>}
                  </div>
                </article>;
              })}
              <div ref={endRef}/>
            </div>
          )}
        </div>
        {current && !atBottom && <button className="cx-jump" onClick={() => { setAtBottom(true); endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }}
          aria-label={t("回到底部")}><ArrowUp size={16} style={{ transform: "rotate(180deg)" }}/></button>}

        <div className="composer-dock">
          <div className="composer-inner">
            {!status.configured && !statusLoading && <div className="preview-hint">
              <span className="preview-hint-dot"/>
              <span>{t("当前为客户端预览，尚未连接真实 CIRO 推理服务")}</span>
              <button onClick={() => setSettingsSection("models")}>{t("如何连接 ")} <span aria-hidden="true">↗</span></button>
            </div>}
            {slashMatches.length > 0 && <div className="cx-slash composer-slash-help" role="listbox" aria-label={t("斜杠命令")}>
              {slashMatches.map(([cmd, desc]) => <button type="button" role="option" aria-selected={false} key={cmd}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { if (cmd === "/goal" || cmd === "/plan") { setComposerMode(cmd === "/goal" ? "goal" : "plan"); setDraft(""); } else handleSlash(cmd); focusComposer(); }}>
                <code>{cmd}</code><span>{t(desc)}</span></button>)}
            </div>}
            <div className={["composer", "cx-composer", composerMode !== "chat" ? "cx-composer--agent" : ""].join(" ")} onClick={() => composerRef.current?.focus()}>
              {attachments.length > 0 && <div className="attachments">
                {attachments.map((file) => <span className="attachment-chip" key={file.id}>
                  <FileText size={14}/><span>{file.name}</span>
                  <button aria-label={t("移除 ") + file.name} onClick={(event) => {
                    event.stopPropagation();
                    setAttachments((prev) => prev.filter((item) => item.id !== file.id));
                  }}><X size={13}/></button>
                </span>)}
              </div>}
              <textarea ref={composerRef} value={draft} rows={1}
                onChange={(event) => {
                  setDraft(event.target.value);
                  event.target.style.height = "auto";
                  event.target.style.height = Math.min(event.target.scrollHeight, 220) + "px";
                }}
                onKeyDown={onComposerKeyDown} onPaste={onPaste}
                placeholder={composerMode === "goal" ? t("描述你希望 Ciro 自主完成的目标…") : composerMode === "plan" ? t("描述需要规划的任务…")
                  : !current && viewProject ? t("在此项目中开始新对话…") : t("向 Ciro 发送消息…")}
                aria-label={t("向 Ciro 发送消息")}/>
              <div className="composer-toolbar">
                <div className="composer-toolbar-left">
                  <input ref={fileInputRef} type="file" hidden multiple onChange={chooseFiles}
                    accept=".txt,.md,.markdown,.json,.csv,.ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.html,.css,.scss,.xml,.yaml,.yml,.toml,.ini,.sql,.log,.sh,.ps1,.go,.rs,.java,.kt,.swift,.c,.cc,.cpp,.h,.hpp,.cs,.rb,.php,.vue,.svelte"/>
                  <div className="cx-plus" ref={plusRef}>
                    <button type="button" className={plusOpen ? "cx-tool cx-tool--round cx-tool--open" : "cx-tool cx-tool--round"} aria-label={t("添加附件与模式")}
                      aria-expanded={plusOpen} title={t("添加附件与模式")} onClick={(e) => { e.stopPropagation(); setPlusOpen((v) => !v); }}>
                      <Plus size={18}/></button>
                    {plusOpen && <div className="cx-plus-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                      <button role="menuitem" onClick={() => { setPlusOpen(false); fileInputRef.current?.click(); }}>
                        <Paperclip size={16}/><span><strong>{t("添加附件")}</strong><small>{t("文本或代码，最多 3 个")}</small></span></button>
                      <div className="cx-menu-sep"/>
                      <button role="menuitemradio" aria-checked={composerMode === "goal"} onClick={() => { setPlusOpen(false); setComposerMode(composerMode === "goal" ? "chat" : "goal"); focusComposer(); }}>
                        <Target size={16}/><span><strong>{t("目标模式")}</strong><small>{t("交给代理自主执行并验证")}</small></span>{composerMode === "goal" && <Check size={15}/>}</button>
                      <button role="menuitemradio" aria-checked={composerMode === "plan"} onClick={() => { setPlusOpen(false); setComposerMode(composerMode === "plan" ? "chat" : "plan"); focusComposer(); }}>
                        <ListChecks size={16}/><span><strong>{t("计划模式")}</strong><small>{t("只生成计划，不改动仓库")}</small></span>{composerMode === "plan" && <Check size={15}/>}</button>
                      <div className="cx-menu-sep"/>
                      <button role="menuitem" onClick={() => { setPlusOpen(false); setDraft("/"); focusComposer(); }}>
                        <Sparkles size={16}/><span><strong>{t("斜杠命令")}</strong><small>{t("快速打开工作台与工具")}</small></span></button>
                    </div>}
                  </div>
                  {composerMode !== "chat" && <button type="button" className="cx-mode-pill" onClick={(e) => { e.stopPropagation(); setComposerMode("chat"); }}
                    aria-label={t("退出") + " " + t(composerMode === "goal" ? "目标模式" : "计划模式")}>
                    {composerMode === "goal" ? <Target size={14}/> : <ListChecks size={14}/>}
                    <span>{t(composerMode === "goal" ? "目标模式" : "计划模式")}</span><X size={13}/>
                  </button>}
                  {composerMode === "chat" && <div onClick={(e) => e.stopPropagation()}>
                    <ThinkingDepth value={thinkingLevel} onChange={setThinkingLevel} t={t} note={thinkingNote}/>
                  </div>}
                </div>
                <div className="cx-send-group">
                {canDictate && composerMode === "chat" && <button type="button" className={dictation.listening ? "cx-mic cx-mic--on" : "cx-mic"}
                  onClick={(e) => { e.stopPropagation(); dictation.toggle(); }} aria-pressed={dictation.listening}
                  aria-label={dictation.listening ? t("停止语音输入") : t("语音输入")} title={dictation.listening ? t("停止语音输入") : t("语音输入")}>
                  <Mic size={17}/></button>}
                {busy ? <button className="send-button send-button--stop" onClick={(event) => {
                  event.stopPropagation();
                  controllerRef.current?.abort();
                }} title={t("停止生成") + " (Esc)"} aria-label={t("停止生成")}><Square size={14} fill="currentColor"/></button>
                  : <button className="send-button" onClick={(event) => { event.stopPropagation(); sendMessage(); }}
                    disabled={!draft.trim() && attachments.length === 0} title={t("发送消息")} aria-label={t("发送消息")}>
                    <ArrowUp size={19} strokeWidth={2.4}/>
                  </button>}
                </div>
              </div>
            </div>
              {!current && !viewProject && !temporaryMode && <div className="cx-suggestions">
              {prompts.map((idea, index) => {
                const Icon = idea.icon;
                return <button className="suggestion-card cx-suggestion" key={idea.title} style={{ animationDelay: index * 60 + "ms" }}
                  onClick={() => choosePrompt(t(idea.prompt))}>
                  <span className={["suggestion-icon", "suggestion-icon--" + idea.tint].join(" ")}><Icon size={18} strokeWidth={1.9}/></span>
                  <span className="suggestion-copy"><strong>{t(idea.title)}</strong><small>{t(idea.detail)}</small></span>
                </button>;
              })}
            </div>}
            <p className="composer-disclaimer">{t(composerMode === "chat" ? "Ciro 可能出错，请核实重要信息。" : "代理执行受权限和验证器约束。")} <span>{preferences.sendWithEnter ? t("Enter 发送 · Shift + Enter 换行") : t("Ctrl / ⌘ + Enter 发送 · Enter 换行")}</span></p>
          </div>
        </div>
      </main>}

      {settingsSection && <SettingsCenter
        initialSection={settingsSection}
        onClose={() => setSettingsSection(null)}
        themePref={themePref} onThemePrefChange={setThemePref}
        appearance={appearance} onAppearanceChange={setAppearance}
        customImageUrl={customImageUrl} onUploadImage={uploadWallpaper} onRemoveImage={removeWallpaper}
        preferences={preferences} onPreferencesChange={setPreferences}
        instructions={instructions} onInstructionsChange={setInstructions}
        language={language} languagePref={languagePref} onLanguagePrefChange={setLanguagePref}
        displayName={profile.displayName} onDisplayNameChange={(displayName) => setProfile({ displayName })}
        status={status} model={model} onModelChange={setModel}
        onRefreshStatus={refreshStatus} conversations={conversations}
        onExportAll={exportAllConversations} onClearHistory={clearHistory}
      />}
      {paletteOpen && <SearchPalette t={t} conversations={conversations} commands={paletteCommands}
        onSelectChat={selectChat} onClose={() => setPaletteOpen(false)}/>}
      {toast && <div className="toast" role="status" key={toast}><Check size={16}/> {toast}</div>}
    </div>
  );
}
