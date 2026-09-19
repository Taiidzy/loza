export interface FileInfo {
  id: string;
  path: string;
  name: string;
  isDir: boolean;
  sizeBytes: number;
  mimeType: string | null;
  createdAt: string;
  updatedAt: string;
  /** SHA-256 контента (hex); может отсутствовать для директорий и старых файлов. */
  sha256?: string | null;
}

export interface ShareInfo {
  id: string;
  token: string;
  createdAt: string;
  expiresAt: string | null;
  isActive: boolean;
}

export interface CreatedShare {
  share: ShareInfo;
  url: string;
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

export type BatchOperation = "copy" | "move" | "delete";

export interface BatchItemResult {
  path: string;
  targetPath: string | null;
  success: boolean;
  error: string | null;
  file: FileInfo | null;
}

export interface BatchResponse {
  operation: BatchOperation;
  results: BatchItemResult[];
}

export interface PathUploadResult {
  filename: string;
  success: boolean;
  message: string | null;
  targetPath: string | null;
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
