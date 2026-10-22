export type BlockType =
  | "text"
  | "heading"
  | "image"
  | "table"
  | "code"
  | "quote"
  | "divider"
  | "math"
  | "html";
export interface Annotation {
  id: string;
  x: number;
  y: number;
  text: string;
}
export interface Block {
  id: string;
  type: BlockType;
  html?: string;
  src?: string;
  name?: string;
  width?: number;
  caption?: string;
  annotations?: Annotation[];
}
export interface Original {
  kind: "html" | "markdown" | "text" | "image";
  content: string;
  name?: string;
  capturedAt: string;
}
export interface Revision {
  id: string;
  at: string;
  title: string;
  blocks: Block[];
}
export interface Note {
  id: string;
  title: string;
  folderId: string | null;
  tags: string[];
  favorite: boolean;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  order: number;
  blocks: Block[];
  originals: Original[];
  revisions: Revision[];
  sourceUrl?: string;
}
export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
}
export interface Workspace {
  schemaVersion: 1;
  notes: Note[];
  folders: Folder[];
}
export type SaveStatus = "loading" | "saving" | "saved" | "error";
export const uid = () => crypto.randomUUID();
