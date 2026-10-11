import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowDownToLine, ArrowUp, BrainCircuit, Check, ChevronDown, Code2,
  Copy, FileText, Lightbulb, Menu, MessageCircle, Moon, MoreHorizontal,
  Paperclip, Pencil, PanelLeftClose, PanelLeftOpen, Plus, RotateCcw,
  Search, Settings2, ShieldCheck, Sparkles, Square, Sun, Trash2, X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getApiStatus, streamChat } from "./lib/api";
import {
  loadActiveId, loadConversations, loadTheme, newId,
  saveActiveId, saveConversations, saveTheme
} from "./lib/storage";
import type { ApiStatus, ChatMessage, Conversation } from "./types";

type Attachment = { id: string; name: string; content: string };
const PREVIEW: ApiStatus = { configured: false, model: "ciro", models: ["ciro"], mode: "preview" };
const PREVIEW_MESSAGE =
  "**这是 Ciro 客户端的界面预览，并非模型回答。**\n\n" +
  "聊天、历史记录与交互已就绪，但尚未接入真实推理服务。\n\n" +
  "请在服务端配置 \`CIRO_API_BASE_URL\`、\`CIRO_MODEL\`，然后重启服务。" +
  "当前不会伪造 CIRO 的推理结果。";

const prompts: { title: string; detail: string; prompt: string; icon: LucideIcon; tint: string }[] = [
  {
    title: "理清一个复杂问题",
    detail: "找到关键变量与下一步",
    prompt: "帮我系统分析这个问题：请先列出关键假设、未知变量和验证步骤。",
    icon: BrainCircuit, tint: "mint"
  },
  {
    title: "一起写点代码",
    detail: "从思路到可运行实现",
    prompt: "请帮我设计一个可靠的软件模块，先明确需求、接口和测试方案。",
    icon: Code2, tint: "lavender"
  },
  {
    title: "提炼文章与资料",
    detail: "把信息整理成洞见",
    prompt: "请帮我总结一篇文章的核心观点、证据和可执行启发。",
    icon: FileText, tint: "peach"
  },
  {
    title: "探索新的想法",
    detail: "让灵感更进一步",
    prompt: "和我一起头脑风暴，提出几个有新意、可验证的研究方向。",
    icon: Lightbulb, tint: "blue"
  }
];

const acceptedExtensions = /\.(txt|md|markdown|json|csv|ts|tsx|js|jsx|py|html|css|xml|yaml|yml|toml|sql|log|sh|go|rs|java|c|cpp|h)$/i;

function CiroMark({ small = false }: { small?: boolean }) {
  return <span className={small ? "ciro-mark ciro-mark--small" : "ciro-mark"} aria-hidden="true">
    <svg viewBox="0 0 44 44" fill="none">
      <path d="M29.8 12.2a13.5 13.5 0 1 0 0 19.6" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <circle cx="31.1" cy="22" r="3.6" fill="currentColor" />
    </svg>
  </span>;
}

function dateGroup(time: number) {
  const now = new Date();
  const target = new Date(time);
  if (now.toDateString() === target.toDateString()) return "今天";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (yesterday.toDateString() === target.toDateString()) return "昨天";
  return "更早";
}

function formatTitle(raw: string) {
  const firstLine = raw.replace(/\s+/g, " ").trim();
  return firstLine.slice(0, 30) || "新的对话";
}

function fileSafeName(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 70) || "ciro-chat";
}

function exportMarkdown(chat: Conversation) {
  const body = ["# " + chat.title, "", "导出自 Ciro · " + new Date().toLocaleString("zh-CN"), ""];
  chat.messages.forEach((message) => {
    body.push("## " + (message.role === "user" ? "你" : message.preview ? "客户端提示（非模型输出）" : "Ciro"));
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

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const [activeId, setActiveId] = useState<string | null>(loadActiveId);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [status, setStatus] = useState<ApiStatus>(PREVIEW);
  const [statusLoading, setStatusLoading] = useState(true);
  const [model, setModel] = useState("ciro");
  const [theme, setTheme] = useState<"light" | "dark">(loadTheme);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const current = conversations.find((item) => item.id === activeId);
  const sorted = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations]
  );
  const filtered = sorted.filter((chat) => {
    const term = search.trim().toLowerCase();
    return !term || chat.title.toLowerCase().includes(term) ||
      chat.messages.some((message) => message.content.toLowerCase().includes(term));
  });
  const grouped = ["今天", "昨天", "更早"].map((label) => ({
    label,
    chats: filtered.filter((chat) => dateGroup(chat.updatedAt) === label)
  })).filter((item) => item.chats.length > 0);

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

  useEffect(() => { void refreshStatus(); }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => saveConversations(conversations), 300);
    return () => window.clearTimeout(timer);
  }, [conversations]);
  useEffect(() => { saveActiveId(activeId); }, [activeId]);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    saveTheme(theme);
  }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: busy ? "instant" : "smooth" });
  }, [activeId, current?.messages.at(-1)?.content, busy]);
  useEffect(() => {
    function shortcuts(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        setSidebarCollapsed(false);
        setSidebarOpen(true);
        window.setTimeout(() => searchRef.current?.focus(), 0);
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        setActiveId(null);
        setDraft("");
        setSidebarOpen(false);
        window.setTimeout(() => composerRef.current?.focus(), 0);
      }
    }
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, []);
  useEffect(() => () => controllerRef.current?.abort(), []);

  function updateAssistant(conversationId: string, messageId: string, content: string) {
    setConversations((old) => old.map((chat) => chat.id === conversationId
      ? { ...chat, messages: chat.messages.map((m) => m.id === messageId ? { ...m, content } : m) }
      : chat
    ));
  }

  async function generateReply(conversationId: string, history: ChatMessage[]) {
    const assistantId = newId();
    const reply: ChatMessage = { id: assistantId, role: "assistant", content: "", createdAt: Date.now(), preview: !status.configured };
    setConversations((old) => old.map((chat) =>
      chat.id === conversationId ? { ...chat, messages: [...chat.messages, reply] } : chat
    ));

    if (!status.configured) {
      updateAssistant(conversationId, assistantId, PREVIEW_MESSAGE);
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setGeneratingId(conversationId);
    let answer = "";
    try {
      await streamChat({
        model,
        messages: history,
        signal: controller.signal,
        onDelta: (text) => {
          answer += text;
          updateAssistant(conversationId, assistantId, answer);
        }
      });
      if (!answer) throw new Error("接口未返回任何文本");
    } catch (error) {
      if (controller.signal.aborted) {
        if (!answer) updateAssistant(conversationId, assistantId, "生成已停止。");
      } else {
        const message = error instanceof Error ? error.message : "未知错误";
        updateAssistant(conversationId, assistantId,
          (answer ? answer + "\n\n---\n\n" : "") + "⚠️ 生成中断：" + message);
        setToast("请求失败，请检查 CIRO 后端");
      }
    } finally {
      controllerRef.current = null;
      setGeneratingId(null);
      setBusy(false);
    }
  }

  function createNew() {
    setActiveId(null);
    setDraft("");
    setAttachments([]);
    setModelOpen(false);
    setRowMenuId(null);
    setSidebarOpen(false);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  function selectChat(id: string) {
    setActiveId(id);
    setSidebarOpen(false);
    setRowMenuId(null);
    setModelOpen(false);
  }

  function sendMessage(textOverride?: string) {
    if (busy) return;
    const text = (textOverride ?? draft).trim();
    if (!text && attachments.length === 0) return;

    const attachmentText = attachments.map((file) =>
      "附件：" + file.name + "\n\n\`\`\`text\n" + file.content + "\n\`\`\`"
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
        title: formatTitle(text || attachments[0]?.name || "新的对话"),
        createdAt: now,
        updatedAt: now,
        messages: [user]
      }, ...prev]);
    }
    setActiveId(conversationId);
    setDraft("");
    setAttachments([]);
    setSidebarOpen(false);
    void generateReply(conversationId, history);
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
    void generateReply(current.id, history);
  }

  function renameChat(chat: Conversation) {
    setRowMenuId(null);
    const value = window.prompt("重命名对话", chat.title)?.trim();
    if (!value) return;
    setConversations((prev) => prev.map((item) =>
      item.id === chat.id ? { ...item, title: value.slice(0, 80) } : item));
  }

  function deleteChat(chat: Conversation) {
    setRowMenuId(null);
    if (!window.confirm('确定删除“' + chat.title + '”？此操作无法撤销。')) return;
    if (generatingId === chat.id) controllerRef.current?.abort();
    setConversations((prev) => prev.filter((item) => item.id !== chat.id));
    if (activeId === chat.id) setActiveId(null);
  }

  function clearHistory() {
    if (!window.confirm("确定清空全部本地对话？此操作无法撤销。")) return;
    controllerRef.current?.abort();
    setConversations([]);
    setActiveId(null);
    setSettingsOpen(false);
    setToast("本地对话已清空");
  }

  async function copyContent(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setToast("已复制到剪贴板");
    } catch {
      setToast("复制失败，请检查浏览器权限");
    }
  }

  async function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selected.length) return;
    if (attachments.length + selected.length > 3) {
      setToast("一次最多选择 3 个文本附件");
      return;
    }
    if (selected.some((file) => !acceptedExtensions.test(file.name) || file.size > 80_000)) {
      setToast("仅支持常见文本/代码文件，每个不超过 80 KB");
      return;
    }
    try {
      const items = await Promise.all(selected.map(async (file) => ({
        id: newId(), name: file.name, content: await file.text()
      })));
      setAttachments((before) => [...before, ...items].slice(0, 3));
      composerRef.current?.focus();
    } catch {
      setToast("读取附件失败");
    }
  }

  function onComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      sendMessage();
    }
  }

  function choosePrompt(text: string) {
    setDraft(text);
    setSidebarOpen(false);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  const readyLabel = statusLoading ? "正在检查" : status.configured ? "推理接口已配置" : "界面预览模式";

  return (
    <div className="app-shell">
      {sidebarOpen && <button className="mobile-scrim" onClick={() => setSidebarOpen(false)} aria-label="关闭侧栏" />}
      <aside className={[
        "sidebar",
        sidebarOpen ? "sidebar--open" : "",
        sidebarCollapsed ? "sidebar--collapsed" : ""
      ].join(" ")}>
        <div className="sidebar-top">
          <div className="brand-row">
            <button className="brand-button" onClick={createNew} aria-label="Ciro 首页">
              <CiroMark small />
              <span className="brand-copy"><strong>Ciro</strong><small>THINK FURTHER</small></span>
            </button>
            <button className="icon-button sidebar-collapse" onClick={() => setSidebarCollapsed((value) => !value)}
              title={sidebarCollapsed ? "展开侧栏" : "折叠侧栏"} aria-label={sidebarCollapsed ? "展开侧栏" : "折叠侧栏"}>
              {sidebarCollapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
            </button>
            <button className="icon-button mobile-sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="关闭侧栏">
              <X size={19} />
            </button>
          </div>
          <button className="new-chat" onClick={createNew} title="新对话 (Ctrl/⌘ + Shift + O)">
            <Plus size={18} strokeWidth={2.2} /><span>开启新对话</span>
          </button>
          <button className="search-trigger" onClick={() => {
            setSearchOpen(true);
            setSidebarCollapsed(false);
            window.setTimeout(() => searchRef.current?.focus(), 0);
          }} title="搜索对话 (Ctrl/⌘ + K)">
            <Search size={17} /><span>搜索历史对话</span><kbd>⌘ K</kbd>
          </button>
          {searchOpen && !sidebarCollapsed && <div className="search-box">
            <Search size={16} />
            <input ref={searchRef} aria-label="搜索对话" placeholder="搜索标题和内容…" value={search}
              onChange={(event) => setSearch(event.target.value)} />
            <button className="bare-icon" onClick={() => { setSearch(""); setSearchOpen(false); }} aria-label="关闭搜索"><X size={16} /></button>
          </div>}
        </div>
        <div className="history-panel">
          {grouped.length === 0 && !sidebarCollapsed &&
            <div className="history-empty">{search ? "没有找到相关对话" : "还没有历史对话\n开始一次新的探索吧"}</div>}
          {grouped.map((group) => (
            <div className="history-group" key={group.label}>
              <div className="history-label">{group.label}</div>
              {group.chats.map((chat) => (
                <div className={["history-row", activeId === chat.id ? "history-row--active" : ""].join(" ")} key={chat.id}>
                  <button className="history-item" title={chat.title} onClick={() => selectChat(chat.id)}>
                    <MessageCircle size={16} strokeWidth={1.8} />
                    <span>{chat.title}</span>
                  </button>
                  <button className="history-more" onClick={() => setRowMenuId((id) => id === chat.id ? null : chat.id)}
                    aria-label={"管理对话：" + chat.title} title="更多操作"><MoreHorizontal size={17} /></button>
                  {rowMenuId === chat.id && <div className="history-popover">
                    <button onClick={() => renameChat(chat)}><Pencil size={15} /> 重命名</button>
                    <button onClick={() => { exportMarkdown(chat); setRowMenuId(null); setToast("已导出 Markdown"); }}>
                      <ArrowDownToLine size={15} /> 导出对话
                    </button>
                    <button className="danger" onClick={() => deleteChat(chat)}><Trash2 size={15} /> 删除对话</button>
                  </div>}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="privacy-note"><ShieldCheck size={17} /><span>对话保存在此浏览器</span></div>
          <button className="sidebar-setting" onClick={() => setTheme((value) => value === "light" ? "dark" : "light")}
            title="切换主题">
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
            <span>{theme === "light" ? "深色模式" : "浅色模式"}</span>
          </button>
          <button className="sidebar-setting" onClick={() => setSettingsOpen(true)} title="设置">
            <Settings2 size={18} /><span>设置与连接</span>
          </button>
          <div className="sidebar-version">CIRO CLIENT <span>V0.1 PREVIEW</span></div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="打开侧栏">
              <Menu size={21} />
            </button>
            {sidebarCollapsed && <button className="icon-button desktop-expand" onClick={() => setSidebarCollapsed(false)} aria-label="展开侧栏">
              <PanelLeftOpen size={21} />
            </button>}
            <div className="model-selector">
              <button className="model-trigger" onClick={() => setModelOpen((value) => !value)}
                aria-expanded={modelOpen} aria-label="切换模型">
                <span className="model-name">{model === "ciro" ? "Ciro" : model}</span>
                <ChevronDown size={17} className={modelOpen ? "chevron-up" : ""} />
              </button>
              {modelOpen && <div className="model-menu">
                <div className="dropdown-caption">可用模型</div>
                {(status.models.length ? status.models : ["ciro"]).map((item) => (
                  <button key={item} className="model-option" onClick={() => { setModel(item); setModelOpen(false); }}>
                    <CiroMark small />
                    <span><strong>{item === "ciro" ? "Ciro" : item}</strong><small>{status.configured ? "由服务端提供" : "等待推理接口接入"}</small></span>
                    {item === model && <Check size={17} className="model-check" />}
                  </button>
                ))}
              </div>}
            </div>
            <span className="topbar-beta">PREVIEW</span>
          </div>
          <div className="topbar-right">
            <span className={["connection-label", status.configured ? "connection-label--ready" : ""].join(" ")}>
              <span className="status-dot" />{readyLabel}
            </span>
            {current && <button className="icon-button export-button" title="导出本次对话"
              onClick={() => { exportMarkdown(current); setToast("已导出 Markdown"); }}
              aria-label="导出本次对话"><ArrowDownToLine size={19} /></button>}
            <button className="icon-button topbar-settings" onClick={() => setSettingsOpen(true)}
              title="设置" aria-label="设置"><Settings2 size={19} /></button>
            <span className="avatar" title="本地访客">访</span>
          </div>
        </header>

        <div className={current ? "content-area content-area--chat" : "content-area content-area--welcome"}>
          {!current ? (
            <section className="welcome">
              <div className="hero-icon"><CiroMark /></div>
              <div className="eyebrow"><span /> YOUR THINKING SPACE <span /></div>
              <h1>让每一个想法，<br /><em>走得更远。</em></h1>
              <p className="welcome-subtitle">你好，我是 <strong>Ciro</strong>。从一个好问题开始，探索下一种可能。</p>
              <div className="suggestion-grid">
                {prompts.map((idea) => {
                  const Icon = idea.icon;
                  return <button className="suggestion-card" key={idea.title} onClick={() => choosePrompt(idea.prompt)}>
                    <span className={["suggestion-icon", "suggestion-icon--" + idea.tint].join(" ")}>
                      <Icon size={20} strokeWidth={1.9} />
                    </span>
                    <span className="suggestion-copy"><strong>{idea.title}</strong><small>{idea.detail}</small></span>
                    <ArrowUp size={15} className="suggestion-arrow" />
                  </button>;
                })}
              </div>
            </section>
          ) : (
            <div className="messages" aria-live="polite">
              <div className="conversation-intro">
                <span className="conversation-intro-mark"><Sparkles size={15} /></span>
                <span>与 Ciro 的对话</span>
              </div>
              {current.messages.map((message, index) => {
                const assistant = message.role === "assistant";
                const lastAssistant = assistant && index === current.messages.length - 1;
                const isStreaming = busy && generatingId === current.id && lastAssistant;
                return <article key={message.id} className={["message", assistant ? "message--assistant" : "message--user"].join(" ")}>
                  {assistant && <div className="message-avatar"><CiroMark small /></div>}
                  <div className="message-body">
                    {assistant ? (
                      <div className={["message-prose", message.preview ? "message-prose--preview" : ""].join(" ")}>
                        {message.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />
                          }}>{message.content}</ReactMarkdown> : null}
                        {isStreaming && <span className="typing-cursor" aria-label="正在生成" />}
                      </div>
                    ) : (
                      <div className="user-bubble">{message.content}</div>
                    )}
                    {assistant && message.content && !isStreaming && <div className="message-actions">
                      <button aria-label="复制回答" title="复制回答" onClick={() => void copyContent(message.content)}>
                        <Copy size={15} />
                      </button>
                      {lastAssistant && <button aria-label="重新生成" title="重新生成" onClick={regenerate} disabled={busy}>
                        <RotateCcw size={15} />
                      </button>}
                      {message.preview && <span className="preview-tag">界面提示 · 非 AI 输出</span>}
                    </div>}
                  </div>
                </article>;
              })}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <div className="composer-dock">
          <div className="composer-inner">
            {!status.configured && !statusLoading && <div className="preview-hint">
              <span className="preview-hint-dot" />
              <span>当前为客户端预览，尚未连接真实 CIRO 推理服务</span>
              <button onClick={() => setSettingsOpen(true)}>如何连接 <span aria-hidden="true">↗</span></button>
            </div>}
            <div className="composer" onClick={() => composerRef.current?.focus()}>
              {attachments.length > 0 && <div className="attachments">
                {attachments.map((file) => <span className="attachment-chip" key={file.id}>
                  <FileText size={14} /><span>{file.name}</span>
                  <button aria-label={"移除 " + file.name} onClick={(event) => {
                    event.stopPropagation();
                    setAttachments((prev) => prev.filter((item) => item.id !== file.id));
                  }}><X size={13} /></button>
                </span>)}
              </div>}
              <textarea ref={composerRef} value={draft} rows={2}
                onChange={(event) => {
                  setDraft(event.target.value);
                  event.target.style.height = "auto";
                  event.target.style.height = Math.min(event.target.scrollHeight, 180) + "px";
                }}
                onKeyDown={onComposerKeyDown}
                placeholder="向 Ciro 发送消息…" aria-label="向 Ciro 发送消息" />
              <div className="composer-toolbar">
                <div className="composer-toolbar-left">
                  <input ref={fileInputRef} type="file" hidden multiple
                    accept=".txt,.md,.markdown,.json,.csv,.ts,.tsx,.js,.jsx,.py,.html,.css,.xml,.yaml,.yml,.toml,.sql,.log,.sh,.go,.rs,.java,.c,.cpp,.h"
                    onChange={(event) => void chooseFiles(event)} />
                  <button className="composer-tool" title="添加文本或代码附件（最多 3 个）"
                    onClick={(event) => { event.stopPropagation(); fileInputRef.current?.click(); }} aria-label="添加附件">
                    <Paperclip size={19} /><span>添加附件</span>
                  </button>
                  <span className="toolbar-divider" />
                  <span className="composer-mode"><Sparkles size={15} /> 轻松开始，深入思考</span>
                </div>
                {busy ? <button className="send-button send-button--stop" onClick={(event) => {
                  event.stopPropagation();
                  controllerRef.current?.abort();
                }} title="停止生成" aria-label="停止生成"><Square size={16} fill="currentColor" /></button>
                  : <button className="send-button" onClick={(event) => { event.stopPropagation(); sendMessage(); }}
                    disabled={!draft.trim() && attachments.length === 0} title="发送消息" aria-label="发送消息">
                    <ArrowUp size={20} strokeWidth={2.4} />
                  </button>}
              </div>
            </div>
            <p className="composer-disclaimer">Ciro 可能出错，请核实重要信息。 <span>Enter 发送 · Shift + Enter 换行</span></p>
          </div>
        </div>
      </main>

      {settingsOpen && <div className="modal-backdrop" role="presentation"
        onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
        <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <div className="settings-head">
            <div><span className="settings-eyebrow">YOUR WORKSPACE</span><h2 id="settings-title">设置与连接</h2></div>
            <button className="icon-button" onClick={() => setSettingsOpen(false)} title="关闭设置" aria-label="关闭设置"><X size={20} /></button>
          </div>
          <div className="settings-section">
            <h3>推理服务</h3>
            <div className="setting-status">
              <span className={["setting-status-icon", status.configured ? "setting-status-icon--ok" : ""].join(" ")}>
                {status.configured ? <Check size={20} /> : <Sparkles size={20} />}
              </span>
              <div><strong>{status.configured ? "已配置后端地址" : "尚未配置推理服务"}</strong>
                <p>{status.configured ? "API 地址已载入，首次发送时验证实际可用性。" :
                  "现在可体验客户端界面；生成回答需要连接 CIRO 推理服务。"}</p></div>
            </div>
            <div className="settings-code">
              <span>服务端 .env 示例</span>
              <code>CIRO_API_BASE_URL=http://127.0.0.1:8000/v1<br />CIRO_MODEL=ciro</code>
            </div>
            <p className="settings-small">密钥只放在服务器的 .env 中，勿填写到浏览器。正式接入协议见仓库 README。</p>
            <button className="secondary-action" onClick={() => void refreshStatus()}>
              <RotateCcw size={15} /> 重新检查配置
            </button>
          </div>
          <div className="settings-section">
            <h3>显示偏好</h3>
            <button className="setting-line" onClick={() => setTheme((old) => old === "light" ? "dark" : "light")}>
              <span>{theme === "light" ? <Moon size={18} /> : <Sun size={18} />} 界面主题</span>
              <strong>{theme === "light" ? "浅色" : "深色"} <ChevronDown size={16} /></strong>
            </button>
          </div>
          <div className="settings-section settings-last">
            <h3>隐私与数据</h3>
            <p className="settings-small">对话历史目前仅存储在此浏览器的本地空间。删除浏览器数据可能导致历史无法恢复。</p>
            <button className="danger-action" disabled={conversations.length === 0} onClick={clearHistory}>
              <Trash2 size={15} /> 清空本地对话
            </button>
          </div>
        </section>
      </div>}
      {toast && <div className="toast" role="status"><Check size={16} /> {toast}</div>}
    </div>
  );
}
