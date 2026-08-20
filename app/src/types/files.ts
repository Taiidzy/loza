export interface FileInfo {
  id: string;
  path: string;
  name: string;
  isDir: boolean;
  sizeBytes: number;
  mimeType: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDirRequest {
  path: string;
}

export interface MoveRequest {
  from: string;
  to: string;
}

export interface CopyRequest {
  from: string;
  to: string;
}

export interface UploadMeta {
  path?: string;
  filename: string;
  mimeType?: string;
}

export type FileType = "folder" | "image" | "document" | "video" | "audio" | "archive" | "code" | "text" | "file";

export interface Operation {
  id: string;
  type: "upload" | "download";
  filename: string;
  path: string;
  sizeBytes: number;
  transferred: number;
  speed: number;
  eta: number;
  status: "pending" | "active" | "paused" | "completed" | "error" | "cancelled";
  error?: string;
  progress: number;
  file?: File;
}