import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Operation } from "../../types/files";
import { fileApi } from "../../api/filesService";
import { formatBytes } from "../../shared/utils/serverStorage";
import { logger } from "../../shared/utils/logger";
import {
  Upload, Download, X, CheckCircle, AlertCircle, Loader,
  RefreshCw,
} from "lucide-react";

const CHUNK_SIZE = 512 * 1024; // 512KB chunks for progressive upload

export function useOperationQueue() {
  const [operations, setOperations] = useState<Operation[]>([]);
  const operationsRef = useRef<Map<string, AbortController>>(new Map());

  const addOperation = useCallback((op: Omit<Operation, "id" | "progress" | "transferred" | "speed" | "eta" | "status"> & { sizeBytes: number }): string => {
    const id = crypto.randomUUID();
    const newOp: Operation = {
      id,
      type: op.type,
      filename: op.filename,
      path: op.path,
      sizeBytes: op.sizeBytes,
      transferred: 0,
      speed: 0,
      eta: 0,
      status: "pending",
      progress: 0,
      file: op.file,
    };
    setOperations((prev) => [...prev, newOp]);
    return id;
  }, []);

  const updateOperation = useCallback((id: string, updates: Partial<Operation>) => {
    setOperations((prev) =>
      prev.map((op) => (op.id === id ? { ...op, ...updates } : op))
    );
  }, []);

  const removeOperation = useCallback((id: string) => {
    setOperations((prev) => prev.filter((op) => op.id !== id));
    operationsRef.current.delete(id);
  }, []);

  const cancelOperation = useCallback((id: string) => {
    const controller = operationsRef.current.get(id);
    if (controller) {
      controller.abort();
    }
    updateOperation(id, { status: "cancelled" });
  }, [updateOperation]);

  const uploadFile = useCallback(async (params: {
    path: string;
    filename: string;
    file: File;
  }): Promise<void> => {
    const sizeBytes = params.file.size;
    const id = addOperation({
      type: "upload",
      filename: params.filename,
      path: params.path,
      sizeBytes,
      file: params.file,
    });

    const startTime = Date.now();

    const controller = new AbortController();
    operationsRef.current.set(id, controller);

    updateOperation(id, { status: "active" });

    try {
      const data = await params.file.arrayBuffer();

      if (controller.signal.aborted) {
        updateOperation(id, { status: "cancelled" });
        return;
      }

      // Simulate progressive upload for large files
      const fileData = new Uint8Array(data);
      const chunks: Uint8Array[] = [];
      let offset = 0;
      while (offset < fileData.length) {
        if (controller.signal.aborted) {
          updateOperation(id, { status: "cancelled" });
          return;
        }
        chunks.push(fileData.slice(offset, offset + CHUNK_SIZE));
        offset += CHUNK_SIZE;
      }

      // Concatenate all chunks
      const combined = new Uint8Array(fileData.length);
      let pos = 0;
      for (const chunk of chunks) {
        if (controller.signal.aborted) {
          updateOperation(id, { status: "cancelled" });
          return;
        }
        combined.set(chunk, pos);
        pos += chunk.length;

        // Update progress
        const now = Date.now();
        const elapsed = now - startTime;
        const transferred = pos;
        const progress = Math.min(95, (transferred / sizeBytes) * 100);
        const speed = elapsed > 0 ? (transferred / (elapsed / 1000)) : 0;
        const eta = speed > 0 ? (sizeBytes - transferred) / speed : 0;

        updateOperation(id, {
          transferred,
          progress,
          speed,
         eta,
      });
      }

      // Final invoke
      const result = await fileApi.uploadFile(params.path, params.filename, combined.buffer);
      updateOperation(id, {
        transferred: sizeBytes,
        progress: 100,
        speed: 0,
        eta: 0,
        status: "completed",
      });
      logger.success("files", "Upload completed", result);
      return;
    } catch (e: any) {
      if (controller.signal.aborted) {
        updateOperation(id, { status: "cancelled" });
      } else {
        updateOperation(id, {
          status: "error",
          error: e.message || "Upload failed",
          progress: 0,
        });
      }
      throw e;
    } finally {
      operationsRef.current.delete(id);
    }
  }, [addOperation, updateOperation]);

  const retry = useCallback(async (operation: Operation) => {
    removeOperation(operation.id);
    if (operation.type === "upload" && operation.file) {
      try {
        await uploadFile({
          path: operation.path,
          filename: operation.filename,
          file: operation.file,
        });
      } catch {
        // uploadFile already sets status to "error" internally
      }
    }
  }, [uploadFile, removeOperation]);

  const downloadFile = useCallback(async (params: {
    path: string;
    filename: string;
    sizeBytes: number;
  }): Promise<void> => {
    const id = addOperation({
      type: "download",
      filename: params.filename,
      path: params.path,
      sizeBytes: params.sizeBytes,
    });

    const startTime = Date.now();
    const controller = new AbortController();
    operationsRef.current.set(id, controller);

    updateOperation(id, { status: "active" });

    try {
      const blob = await fileApi.downloadFile(params.path);

      if (controller.signal.aborted) {
        updateOperation(id, { status: "cancelled" });
        return;
      }

      const sizeBytes = blob.size;
      const now = Date.now();
      const elapsed = now - startTime;
      const speed = elapsed > 0 ? (sizeBytes / (elapsed / 1000)) : 0;

      updateOperation(id, {
        transferred: sizeBytes,
        progress: 100,
        speed,
        eta: 0,
        status: "completed",
      });

      // Trigger browser download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = params.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      if (controller.signal.aborted) {
        updateOperation(id, { status: "cancelled" });
      } else {
        updateOperation(id, {
          status: "error",
          error: e.message || "Download failed",
        });
      }
      throw e;
    } finally {
      operationsRef.current.delete(id);
    }
  }, [addOperation, updateOperation]);

  return {
    operations,
    uploadFile,
    downloadFile,
    cancelOperation,
    removeOperation,
    retry,
  };
}

function formatEta(seconds: number): string {
  if (seconds < 1) return "";
  if (seconds < 60) return `${Math.floor(seconds)}с`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m < 60) return `${m}м ${s}с`;
  const h = Math.floor(m / 60);
  const mins = m % 60;
  return `${h}ч ${mins}м`;
}

export default function OperationQueue({
  operations,
  onCancel,
  onClose,
  onRetry,
}: {
  operations: Operation[];
  onCancel: (id: string) => void;
  onClose: (id: string) => void;
  onRetry: (operation: Operation) => void;
}) {
  if (operations.length === 0) return null;

  return (
    <div style={{
      position: "fixed",
      bottom: 20,
      right: 20,
      display: "flex",
      flexDirection: "column",
      gap: 8,
      zIndex: 1000,
      maxWidth: 360,
    }}>
      <AnimatePresence>
        {operations.map((op) => (
          <OperationCard
            key={op.id}
            operation={op}
            onCancel={onCancel}
            onClose={onClose}
            onRetry={onRetry}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

function OperationCard({
  operation,
  onCancel,
  onClose,
  onRetry,
}: {
  operation: Operation;
  onCancel: (id: string) => void;
  onClose: (id: string) => void;
  onRetry: (operation: Operation) => void;
}) {
  const icon = operation.type === "upload" ? <Upload size={14} /> : <Download size={14} />;
  const statusColor = {
    pending: "var(--color-text-muted)",
    active: "var(--color-accent)",
    paused: "var(--color-warning)",
    completed: "var(--color-success)",
    error: "var(--color-error)",
    cancelled: "var(--color-text-muted)",
  }[operation.status];

  const StatusIcon = {
    pending: <Loader size={12} style={{ animation: "spin 1s linear infinite" }} />,
    active: <Loader size={12} style={{ animation: "spin 1s linear infinite" }} />,
    paused: <AlertCircle size={12} />,
    completed: <CheckCircle size={12} />,
    error: <AlertCircle size={12} />,
    cancelled: <X size={12} />,
  }[operation.status];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      transition={{ duration: 0.18 }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: "var(--radius-md)",
         background: "var(--color-popup-surface)",
        border: "1px solid var(--color-surface-border)",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.2)",
        minWidth: 300,
      }}
    >
      <div style={{
        width: 32,
        height: 32,
        borderRadius: "var(--radius-sm)",
        background: "color-mix(in srgb, var(--color-accent) 15%, transparent)",
        display: "grid",
        placeItems: "center",
        color: "var(--color-accent)",
        flexShrink: 0,
      }}>
        {icon}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={operation.filename}>
            {operation.filename}
          </span>
          <span style={{ color: statusColor, flexShrink: 0 }}>{StatusIcon}</span>
        </div>

        <div style={{ fontSize: 11, color: "var(--color-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {formatBytes(operation.transferred)} / {formatBytes(operation.sizeBytes)}
          {" · "}
          {operation.speed > 0 && formatBytes(operation.speed)}/сек
          {" · "}
          {operation.eta > 0 && formatEta(operation.eta)}
        </div>

        <div style={{
          height: 3,
          background: "var(--color-surface-border)",
          borderRadius: 999,
          overflow: "hidden",
        }}>
          <motion.div
            style={{
              height: "100%",
              background: "linear-gradient(90deg, var(--color-accent), var(--color-violet))",
              borderRadius: 999,
            }}
            initial={{ width: 0 }}
            animate={{ width: `${operation.progress}%` }}
            transition={{ duration: 0.2 }}
          />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {operation.status === "error" && (
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onRetry(operation)}
            style={{
              width: 24,
              height: 24,
              borderRadius: "var(--radius-sm)",
              background: "transparent",
              border: "1px solid var(--color-surface-border)",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
            }}
            title="Повторить"
          >
            <RefreshCw size={10} />
          </motion.button>
        )}
        {operation.status !== "completed" && operation.status !== "cancelled" && operation.status !== "error" && (
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onCancel(operation.id)}
            style={{
              width: 24,
              height: 24,
              borderRadius: "var(--radius-sm)",
              background: "transparent",
              border: "1px solid var(--color-surface-border)",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
            }}
            title="Отменить"
          >
            <X size={10} />
          </motion.button>
        )}
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => onClose(operation.id)}
          style={{
            width: 20,
            height: 20,
            borderRadius: "var(--radius-sm)",
            background: "transparent",
            border: "1px solid transparent",
            color: "var(--color-text-muted)",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            fontSize: 12,
          }}
          title="Закрыть"
        >
          ×
        </motion.button>
      </div>
    </motion.div>
  );
}
