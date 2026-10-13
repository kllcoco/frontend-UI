import { newId } from "./storage";

export type ProjectFile = { id: string; name: string; content: string; addedAt: number };
export type Project = {
  id: string;
  name: string;
  instructions: string;
  files: ProjectFile[];
  color: string;
  createdAt: number;
  updatedAt: number;
};

export const PROJECT_LIMITS = { instructions: 4000, files: 10, fileBytes: 80_000, totalBytes: 200_000 };
export const PROJECT_COLORS = ["#10845c", "#2f6fdb", "#c9622c", "#8a54d6", "#c23d6e", "#5b7a8c"];

const KEY = "ciro.projects.v1";

export function loadProjects(): Project[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((p): p is Project => !!p && typeof p === "object" && typeof p.id === "string" && typeof p.name === "string")
      .map((p) => ({
        ...p,
        instructions: typeof p.instructions === "string" ? p.instructions : "",
        files: Array.isArray(p.files) ? p.files.filter((f) => f && typeof f.name === "string" && typeof f.content === "string") : [],
        color: typeof p.color === "string" ? p.color : PROJECT_COLORS[0]
      })).slice(0, 50);
  } catch { return []; }
}
export function saveProjects(projects: Project[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(projects.slice(0, 50))); } catch { /* storage full or unavailable */ }
}
export function createProject(name: string, index: number): Project {
  const now = Date.now();
  return { id: newId(), name: name.trim().slice(0, 60) || "新项目", instructions: "", files: [],
    color: PROJECT_COLORS[index % PROJECT_COLORS.length], createdAt: now, updatedAt: now };
}
/** Context sent with chat requests made inside a project (validated again on the server). */
export function projectContext(project: Project | undefined) {
  if (!project) return undefined;
  if (!project.instructions.trim() && project.files.length === 0) return { name: project.name, instructions: "", files: [] };
  return {
    name: project.name,
    instructions: project.instructions.slice(0, PROJECT_LIMITS.instructions),
    files: project.files.map((f) => ({ name: f.name, content: f.content }))
  };
}
