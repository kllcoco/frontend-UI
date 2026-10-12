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
  archived?:boolean;
  shareId?:string;
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
};
