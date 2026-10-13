import { useEffect, useRef, useState } from "react";
import { ArrowUp, CornerUpRight, Quote, Square, X } from "lucide-react";
import CiroMark from "./CiroMark";
import Markdown from "./Markdown";
import { getApiStatus, streamChat } from "../lib/api";
import { loadConversations, loadThemePref, newId, saveConversations, systemTheme } from "../lib/storage";
import { loadLanguage, translate } from "../lib/i18n";
import type { ChatMessage, Conversation } from "../types";

/** Desktop quick ask (Ctrl/⌘+Shift+Space): a small window that answers one question, optionally about
 *  text copied just before, and hands the conversation to the main window to continue. */
export default function QuickAsk() {
  const language = loadLanguage();
  const t = (s: string) => translate(language, s);
  const [quote, setQuote] = useState("");
  const [draft, setDraft] = useState("");
  const [answer, setAnswer] = useState("");
  const [asked, setAsked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [chatId, setChatId] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const pref = loadThemePref();
    document.documentElement.setAttribute("data-theme", pref === "system" ? systemTheme() : pref);
    document.documentElement.classList.add("ciro-ready", "ciro-quick");
    document.title = "Ciro";
    void getApiStatus().then((s) => setModel(s.configured ? s.model : ""), () => setModel(""));
    const reset = (clip: string) => {
      setQuote(clip.trim().length > 1 ? clip.trim() : ""); setDraft(""); setAnswer(""); setAsked(""); setError(""); setChatId(null);
      setTimeout(() => input.current?.focus(), 30);
    };
    const off = window.ciroDesktop?.onQuick?.(({ clipboard }) => { if (!abort.current) reset(clipboard); });
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { abort.current?.abort(); window.ciroDesktop?.quickHide?.(); } };
    window.addEventListener("keydown", esc);
    input.current?.focus();
    return () => { off?.(); window.removeEventListener("keydown", esc); };
  }, []);

  async function ask() {
    const question = draft.trim();
    if (!question || busy) return;
    if (!model) { setError(t("暂时连不上 Ciro 服务，请稍后再试。")); return; }
    const content = quote ? question + "\n\n" + t("引用内容：") + "\n\n> " + quote.split("\n").join("\n> ") : question;
    const user: ChatMessage = { id: newId(), role: "user", content, createdAt: Date.now() };
    setAsked(question); setDraft(""); setAnswer(""); setError(""); setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    let text = "";
    try {
      await streamChat({ model, messages: [user], signal: controller.signal, usageKind: "chat",
        onDelta: (d) => { text += d; setAnswer(text); } });
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally { abort.current = null; setBusy(false); }
    if (!text) return;
    // Keep it in the history so it can be continued in the main window.
    const id = newId();
    const chat: Conversation = { id, title: question.slice(0, 40), createdAt: user.createdAt, updatedAt: Date.now(),
      messages: [user, { id: newId(), role: "assistant", content: text, createdAt: Date.now() }] };
    saveConversations([chat, ...loadConversations()]);
    setChatId(id);
  }

  return <div className="qa-root">
    <header className="qa-head"><CiroMark small/><strong>{t("快速提问")}</strong>
      <span className="qa-hint">Esc {t("关闭")}</span>
      <button type="button" className="qa-icon" onClick={() => window.ciroDesktop?.quickHide?.()} aria-label={t("关闭")}><X size={16}/></button></header>
    {quote && <div className="qa-quote"><Quote size={14}/><p>{quote.length > 400 ? quote.slice(0, 400) + "…" : quote}</p>
      <button type="button" className="qa-icon" onClick={() => setQuote("")} aria-label={t("不引用剪贴板内容")}><X size={14}/></button></div>}
    {(asked || answer || error) && <div className="qa-answer" aria-live="polite">
      {asked && <p className="qa-asked">{asked}</p>}
      {answer ? <Markdown text={answer} copyLabel={t("复制代码")} copiedLabel={t("已复制")}/> : busy ? <p className="qa-wait">{t("思考中…")}</p> : null}
      {error && <p className="qa-error" role="alert">{error}</p>}
    </div>}
    <div className="qa-compose">
      <textarea ref={input} value={draft} rows={2} placeholder={quote ? t("对复制的内容提问，例如：翻译成英文") : t("问 Ciro 任何问题…")}
        aria-label={t("快速提问")} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(); } }}/>
      {busy ? <button type="button" className="qa-send" onClick={() => abort.current?.abort()} aria-label={t("停止生成")}><Square size={14}/></button>
        : <button type="button" className="qa-send" disabled={!draft.trim()} onClick={() => void ask()} aria-label={t("发送消息")}><ArrowUp size={17}/></button>}
    </div>
    {chatId && <button type="button" className="qa-continue" onClick={() => window.ciroDesktop?.quickContinue?.(chatId)}>
      <CornerUpRight size={15}/>{t("在主窗口继续这个对话")}</button>}
  </div>;
}
