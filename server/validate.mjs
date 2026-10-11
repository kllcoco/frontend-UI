const MAX_MESSAGES = 80;
const MAX_CONTENT = 100_000;
const MAX_TOTAL = 250_000;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

export function normalizeModels(rawModels, fallback = "ciro") {
  const values = typeof rawModels === "string" ? rawModels.split(",") : [];
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return unique.length ? unique : [fallback];
}

export function validateChat(input, availableModels) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError("请求格式不正确");
  }
  const { messages, model } = input;
  if (!availableModels.includes(model)) {
    throw new ValidationError("模型不可用");
  }
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_MESSAGES) {
    throw new ValidationError("对话消息数量不正确");
  }

  let total = 0;
  const sanitized = messages.map((message) => {
    if (!message || typeof message !== "object" ||
        !["user", "assistant"].includes(message.role) ||
        typeof message.content !== "string" ||
        message.content.length === 0 ||
        message.content.length > MAX_CONTENT) {
      throw new ValidationError("消息格式不正确");
    }
    total += message.content.length;
    return { role: message.role, content: message.content };
  });
  if (total > MAX_TOTAL || sanitized[sanitized.length - 1].role !== "user") {
    throw new ValidationError("对话内容过长，或缺少最后一条用户消息");
  }
  return { model, messages: sanitized, stream: true };
}
