import { invoke } from "@tauri-apps/api/core";
import { FileInfo, MoveRequest, CopyRequest } from "../types/files";
import { logger } from "../shared/utils/logger";

export class FileApiService {
  // ── List & Info ──────────────────────────────────────────────────────

  async listFiles(path: string): Promise<FileInfo[]> {
    logger.info("files", "invoke(list_files)", { path });
    return await invoke<FileInfo[]>("list_files", { path });
  }

  async getFileInfo(path: string): Promise<FileInfo> {
    logger.info("files", "invoke(get_file_info)", { path });
    return await invoke<FileInfo>("get_file_info", { path });
  }

  // ── Upload ───────────────────────────────────────────────────────────

  async uploadFile(
    path: string,
    filename: string,
    data: Uint8Array,
    overwrite = false,
    progressId?: string
  ): Promise<FileInfo> {
    logger.info("files", "invoke(upload_file)", { path, filename, size: data.byteLength, overwrite });
    return await invoke<FileInfo>("upload_file", {
      path,
      filename,
      data,
      overwrite,
      progressId,
    });
  }

  // ── Download ─────────────────────────────────────────────────────────

  async downloadFile(path: string, progressId?: string): Promise<Uint8Array> {
    logger.info("files", "invoke(download_file)", { path });
    return await invoke<Uint8Array>("download_file", { path, progressId });
  }

  // ── View (in-memory for preview) ─────────────────────────────────────

  async viewFile(path: string): Promise<Blob> {
    const bytes = await this.downloadFile(path);
    return new Blob([bytes]);
  }

  // ── Delete ────────────────────────────────────────────────────────────

  async deleteFile(path: string): Promise<void> {
    logger.info("files", "invoke(delete_file)", { path });
    await invoke<void>("delete_file", { path });
  }

  // ── Rename / Move / Copy ──────────────────────────────────────────────

  async renameFile(from: string, to: string): Promise<FileInfo> {
    logger.info("files", "invoke(rename_file)", { from, to });
    const req: MoveRequest = { from, to };
    return await invoke<FileInfo>("rename_file", { req });
  }

  async moveFile(from: string, to: string): Promise<FileInfo> {
    logger.info("files", "invoke(move_file)", { from, to });
    const req: MoveRequest = { from, to };
    return await invoke<FileInfo>("move_file", { req });
  }

  async copyFile(from: string, to: string): Promise<FileInfo> {
    logger.info("files", "invoke(copy_file)", { from, to });
    const req: CopyRequest = { from, to };
    return await invoke<FileInfo>("copy_file", { req });
  }

  // ── Mkdir ─────────────────────────────────────────────────────────────

  async createDir(path: string): Promise<FileInfo> {
    logger.info("files", "invoke(create_dir)", { path });
    return await invoke<FileInfo>("create_dir", { path });
  }
}

export const fileApi = new FileApiService();
