export type Role = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  preview?: boolean;
  reasoning?: string;
  thinkingMs?: number;
  depth?: string;
  feedback?: "up" | "down";
  images?: { id: string; name: string; thumb: string }[];
  tools?: { name: string; args: string }[];
  webSearch?: boolean;
  /** Assistant: every generated answer for this turn; versionIndex is the one shown. */
  versions?: AnswerVersion[];
  versionIndex?: number;
  /** User: every edit of this prompt together with the conversation that followed it. */
  edits?: { content: string; images?: ChatMessage["images"]; tail: ChatMessage[] }[];
  editIndex?: number;
  suggestions?: string[];
  rememberedId?: string;
  generated?: { id: string; thumb: string }[];
};
export type AnswerVersion = Pick<ChatMessage, "content" | "reasoning" | "thinkingMs" | "tools" | "webSearch" | "createdAt" | "preview" | "feedback">;

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  folder?:string;
  pinned?:boolean;
  projectId?:string;
  temporary?:boolean;
  archived?:boolean;
  shareId?:string;
  canvas?:import("./components/CanvasPanel").CanvasDoc[];
  parentId?:string;
  checkpoints?:{id:string;label:string;createdAt:number;messages:ChatMessage[]}[];
};

export type ApiStatus = {
  configured: boolean;
  model: string;
  models: string[];
  mode: "preview" | "configured";
  reasoningModes?: ("fast"|"deep")[];
  reasoningEffort?: boolean;
  webSearch?: boolean;
  stt?: boolean;
  tts?: boolean;
  images?: boolean;
  team?: boolean;
};
