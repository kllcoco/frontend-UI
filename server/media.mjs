// Optional OpenAI-compatible media endpoints (speech-to-text, text-to-speech, image generation)
// plus the team API contract. Each is off unless explicitly enabled in the server .env.
import express from "express";

const on = (value) => ["1", "true", "on", "yes"].includes(String(value || "").trim().toLowerCase());
const SIZES = new Set(["1024x1024", "1024x1536", "1536x1024", "512x512", "256x256", "1792x1024", "1024x1792"]);

export function mediaFeatures(env = process.env) {
  const configured = Boolean((env.CIRO_API_BASE_URL || "").trim());
  return {
    stt: configured && (on(env.CIRO_VOICE) || on(env.CIRO_STT)),
    tts: configured && (on(env.CIRO_VOICE) || on(env.CIRO_TTS)),
    images: configured && on(env.CIRO_IMAGES),
    team: Boolean((env.CIRO_TEAM_URL || "").trim())
  };
}

export function createMediaRouter({ apiBase, apiKey, env = process.env, fetchFn = fetch }) {
  const router = express.Router();
  const features = mediaFeatures(env);
  const auth = apiKey ? { Authorization: "Bearer " + apiKey } : {};
  const fail = (res, status, error) => res.status(status).json({ error });

  router.post("/voice/transcribe", express.raw({ type: ["audio/*", "application/octet-stream"], limit: "15mb" }), async (req, res) => {
    if (!features.stt) return fail(res, 503, "语音识别未开启：请在服务端设置 CIRO_VOICE=on（或 CIRO_STT=on）");
    if (!Buffer.isBuffer(req.body) || req.body.length < 200) return fail(res, 400, "Audio is empty");
    const type = String(req.get("content-type") || "audio/webm").split(";")[0];
    const form = new FormData();
    form.append("file", new Blob([req.body], { type }), "speech." + (type.split("/")[1] || "webm"));
    form.append("model", env.CIRO_STT_MODEL || "whisper-1");
    const lang = String(req.query.lang || "").slice(0, 5);
    if (/^[a-z]{2}$/.test(lang)) form.append("language", lang);
    try {
      const upstream = await fetchFn(apiBase + "/audio/transcriptions", { method: "POST", headers: auth, body: form });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok || typeof data.text !== "string") return fail(res, 502, "语音识别失败 (HTTP " + upstream.status + ")");
      res.json({ text: data.text.slice(0, 20000) });
    } catch (error) { fail(res, 502, "无法连接语音识别服务：" + error.message); }
  });

  router.post("/voice/speech", async (req, res) => {
    if (!features.tts) return fail(res, 503, "语音合成未开启：请在服务端设置 CIRO_VOICE=on（或 CIRO_TTS=on）");
    const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 4000) : "";
    if (!text) return fail(res, 400, "Text is required");
    try {
      const upstream = await fetchFn(apiBase + "/audio/speech", {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ model: env.CIRO_TTS_MODEL || "tts-1", voice: env.CIRO_TTS_VOICE || "alloy", input: text, response_format: "mp3" })
      });
      if (!upstream.ok) return fail(res, 502, "语音合成失败 (HTTP " + upstream.status + ")");
      res.set({ "Content-Type": upstream.headers.get("content-type") || "audio/mpeg", "Cache-Control": "no-store" });
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) { fail(res, 502, "无法连接语音合成服务：" + error.message); }
  });

  router.post("/images", async (req, res) => {
    if (!features.images) return fail(res, 503, "图片生成未开启：请在服务端设置 CIRO_IMAGES=on 并确认模型服务支持 /images/generations");
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim().slice(0, 4000) : "";
    const size = SIZES.has(req.body?.size) ? req.body.size : "1024x1024";
    if (!prompt) return fail(res, 400, "Prompt is required");
    try {
      const upstream = await fetchFn(apiBase + "/images/generations", {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ model: env.CIRO_IMAGE_MODEL || "gpt-image-1", prompt, n: 1, size })
      });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok || !Array.isArray(data.data)) return fail(res, 502, (data?.error?.message || "图片生成失败") + " (HTTP " + upstream.status + ")");
      const images = [];
      for (const item of data.data.slice(0, 4)) {
        if (typeof item.b64_json === "string") images.push("data:image/png;base64," + item.b64_json);
        else if (typeof item.url === "string" && /^https:\/\//.test(item.url)) {
          // Inline remote results so they survive URL expiry and never leak the upstream host to the browser.
          const img = await fetchFn(item.url);
          const buf = Buffer.from(await img.arrayBuffer());
          if (buf.length < 15_000_000) images.push("data:" + (img.headers.get("content-type") || "image/png") + ";base64," + buf.toString("base64"));
        }
      }
      if (!images.length) return fail(res, 502, "图片服务没有返回图片");
      res.json({ images, revisedPrompt: typeof data.data[0]?.revised_prompt === "string" ? data.data[0].revised_prompt : undefined });
    } catch (error) { fail(res, 502, "无法连接图片生成服务：" + error.message); }
  });

  // Team / multi-account contract: proxied to a dedicated team service when CIRO_TEAM_URL is set.
  router.all(/^\/team(\/.*)?$/, async (req, res) => {
    const base = (env.CIRO_TEAM_URL || "").trim().replace(/\/+$/, "");
    if (!base) {
      if (req.method === "GET" && req.path === "/team") return res.json({ enabled: false });
      return fail(res, 501, "团队功能需要多租户团队服务：请在服务端配置 CIRO_TEAM_URL");
    }
    try {
      const upstream = await fetchFn(base + req.path.replace(/^\/team/, "") , {
        method: req.method,
        headers: { "Content-Type": "application/json", ...(env.CIRO_TEAM_TOKEN ? { Authorization: "Bearer " + env.CIRO_TEAM_TOKEN } : {}),
          "X-Ciro-Principal": String(req.principal?.id || "local") },
        ...(["GET", "HEAD"].includes(req.method) ? {} : { body: JSON.stringify(req.body ?? {}) })
      });
      const data = await upstream.json().catch(() => ({}));
      res.status(upstream.status).json(req.path === "/team" && req.method === "GET" ? { enabled: true, ...data } : data);
    } catch (error) { fail(res, 502, "无法连接团队服务：" + error.message); }
  });
  return router;
}
