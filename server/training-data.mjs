// "使用我的数据改进模型" (Settings → 隐私与安全, off by default): only conversations whose sender turned it on are
// kept for training, and only when the server is set up for it.
//   CIRO_TRAINING_DIR   folder for the opted-in conversations (one JSONL file a day); unset = nothing is kept
//   CIRO_TRAINING_SALT  mixed into the hashed user id (no account ids or e-mail addresses are written)
// The upstream model service is told the user's choice either way (X-Ciro-Training: opt-in / opt-out).
import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

/** The text of an OpenAI-style SSE stream (choices[0].delta.content). */
export function replyFromSse(text) {
  let out = "";
  for (const line of String(text).split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try { const c = JSON.parse(data)?.choices?.[0]?.delta?.content; if (typeof c === "string") out += c; } catch { /* partial line */ }
  }
  return out;
}

export function createTrainingLog(env) {
  const dir = String(env.CIRO_TRAINING_DIR || "").trim();
  const salt = String(env.CIRO_TRAINING_SALT || "ciro");
  return {
    enabled: Boolean(dir),
    /** Records one exchange for an opted-in user. Never throws. */
    async record({ user, model, messages, reply }) {
      if (!dir || !reply) return false;
      try {
        await mkdir(dir, { recursive: true });
        const line = JSON.stringify({
          at: new Date().toISOString(),
          user: createHash("sha256").update(salt + ":" + String(user || "local")).digest("hex").slice(0, 16),
          model: String(model || ""),
          messages: (Array.isArray(messages) ? messages : []).slice(-40)
            .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
            .map((m) => ({ role: m.role, content: m.content.slice(0, 20000) })),
          reply: String(reply).slice(0, 40000)
        });
        await appendFile(join(dir, new Date().toISOString().slice(0, 10) + ".jsonl"), line + "\n");
        return true;
      } catch (e) { console.error("[ciro] training log failed:", e.message); return false; }
    }
  };
}
