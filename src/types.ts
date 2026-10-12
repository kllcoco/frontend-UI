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
};

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
};
