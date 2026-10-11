export type Role = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  preview?: boolean;
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  folder?:string;
  parentId?:string;
  checkpoints?:{id:string;label:string;createdAt:number;messages:ChatMessage[]}[];
};

export type ApiStatus = {
  configured: boolean;
  model: string;
  models: string[];
  mode: "preview" | "configured";
  reasoningModes?: ("fast"|"deep")[];
};
