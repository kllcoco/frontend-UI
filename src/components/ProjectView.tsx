import { localeTag } from "../lib/i18n";
import type { Language } from "../lib/i18n";
import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Download, FileText, FolderOpen, MessageCircle, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import type { Conversation } from "../types";
import type { Project } from "../lib/projects";
import { PROJECT_COLORS, PROJECT_LIMITS } from "../lib/projects";
import { newId } from "../lib/storage";

type Props = {
  t: (text: string) => string;
  project: Project;
  chats: Conversation[];
  language: Language;
  onChange: (project: Project) => void;
  onDelete: () => void;
  onOpenChat: (id: string) => void;
  onNotify: (text: string) => void;
  onExport: () => void;
};

const textFile = /\.(txt|md|markdown|json|csv|ts|tsx|js|jsx|mjs|cjs|py|html|css|scss|xml|yaml|yml|toml|ini|sql|log|sh|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|vue|svelte)$/i;

/** Project home: name, colour, instructions, reference files and the project's chats. */
export default function ProjectView({ t, project, chats, language, onChange, onDelete, onOpenChat, onNotify, onExport }: Props) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(project.name);
  const fileRef = useRef<HTMLInputElement>(null);
  const totalBytes = project.files.reduce((sum, f) => sum + f.content.length, 0);

  function update(patch: Partial<Project>) { onChange({ ...project, ...patch, updatedAt: Date.now() }); }
  function commitName() {
    setEditingName(false);
    const value = name.trim().slice(0, 60);
    if (value && value !== project.name) update({ name: value }); else setName(project.name);
  }
  async function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selected.length) return;
    if (project.files.length + selected.length > PROJECT_LIMITS.files) { onNotify("每个项目最多 10 个文件"); return; }
    if (selected.some((f) => !textFile.test(f.name) || f.size > PROJECT_LIMITS.fileBytes)) { onNotify("仅支持常见文本/代码文件，每个不超过 80 KB"); return; }
    const added = await Promise.all(selected.map(async (f) => ({ id: newId(), name: f.name, content: await f.text(), addedAt: Date.now() })));
    if (totalBytes + added.reduce((s, f) => s + f.content.length, 0) > PROJECT_LIMITS.totalBytes) { onNotify("项目文件总大小不能超过 200 KB"); return; }
    update({ files: [...project.files, ...added] });
    onNotify("文件已添加到项目");
  }

  return <section className="pv-root">
    <header className="pv-head">
      <span className="pv-icon" style={{ background: project.color + "1f", color: project.color }}><FolderOpen size={22}/></span>
      <div className="pv-title">
        {editingName
          ? <input autoFocus className="pv-name-input" value={name} maxLength={60} aria-label={t("项目名称")}
            onChange={(e) => setName(e.target.value)} onBlur={commitName}
            onKeyDown={(e) => { if (e.key === "Enter") commitName(); if (e.key === "Escape") { setName(project.name); setEditingName(false); } }}/>
          : <h1 onDoubleClick={() => setEditingName(true)}>{project.name}</h1>}
        <div className="pv-meta">
          <span>{chats.length} {t("个对话")}</span><span>·</span><span>{project.files.length} {t("个文件")}</span>
          <div className="pv-colors" role="radiogroup" aria-label={t("项目颜色")}>
            {PROJECT_COLORS.map((color) => <button type="button" key={color} role="radio" aria-checked={project.color === color}
              aria-label={color} className={project.color === color ? "pv-color pv-color--on" : "pv-color"}
              style={{ background: color }} onClick={() => update({ color })}/>)}
          </div>
        </div>
      </div>
      <div className="pv-actions">
        <button type="button" className="cx-icon" onClick={onExport} aria-label={t("导出项目")} title={t("导出项目（可分享给团队成员）")}><Download size={16}/></button>
        <button type="button" className="cx-icon" onClick={() => setEditingName(true)} aria-label={t("重命名项目")} title={t("重命名项目")}><Pencil size={16}/></button>
        <button type="button" className="cx-icon pv-danger" aria-label={t("删除项目")} title={t("删除项目")}
          onClick={() => { if (window.confirm(t("删除项目后，其中的对话会移回“最近”，确定删除？"))) onDelete(); }}><Trash2 size={16}/></button>
      </div>
    </header>

    <div className="pv-grid">
      <div className="pv-card">
        <div className="pv-card-head"><strong>{t("项目指令")}</strong><small>{project.instructions.length}/{PROJECT_LIMITS.instructions}</small></div>
        <p className="pv-hint">{t("在此项目的每次对话中，Ciro 都会参考这些指令。")}</p>
        <textarea className="pv-textarea" aria-label={t("项目指令")} rows={6} maxLength={PROJECT_LIMITS.instructions}
          placeholder={t("例如：这是我的毕业论文项目，回答时使用学术语气，并标注引用来源。")}
          value={project.instructions} onChange={(e) => update({ instructions: e.target.value })}/>
      </div>
      <div className="pv-card">
        <div className="pv-card-head"><strong>{t("项目文件")}</strong>
          <small>{Math.round(totalBytes / 1000)} / {PROJECT_LIMITS.totalBytes / 1000} KB</small></div>
        <p className="pv-hint">{t("文本或代码文件会作为参考资料随项目对话发送。")}</p>
        <div className="pv-files">
          {project.files.map((file) => <div className="pv-file" key={file.id}>
            <FileText size={15}/><span title={file.name}>{file.name}</span><small>{(file.content.length / 1000).toFixed(1)} KB</small>
            <button type="button" aria-label={t("移除 ") + file.name} onClick={() => update({ files: project.files.filter((f) => f.id !== file.id) })}><X size={14}/></button>
          </div>)}
          <button type="button" className="pv-add-file" onClick={() => fileRef.current?.click()}><Upload size={15}/>{t("添加文件")}</button>
          <input ref={fileRef} type="file" hidden multiple onChange={(e) => void addFiles(e)}/>
        </div>
      </div>
    </div>

    <div className="pv-chats">
      <div className="pv-card-head"><strong>{t("项目中的对话")}</strong></div>
      {chats.length === 0 && <div className="pv-empty"><Plus size={16}/>{t("在下方输入框开始此项目的第一个对话")}</div>}
      {chats.map((chat) => <button type="button" className="pv-chat" key={chat.id} onClick={() => onOpenChat(chat.id)}>
        <MessageCircle size={16}/>
        <span className="pv-chat-copy"><strong>{chat.title}</strong>
          <small>{(chat.messages.find((m) => m.role === "assistant" && !m.preview)?.content || chat.messages[0]?.content || "").slice(0, 120)}</small></span>
        <time>{new Date(chat.updatedAt).toLocaleDateString(localeTag(language), { month: "short", day: "numeric" })}</time>
      </button>)}
    </div>
  </section>;
}
