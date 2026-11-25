import { reassembleChunks } from '../../../lib/fileTransfer';

export interface InboundChunkSink {
  readonly mode: 'disk-opfs' | 'memory';
  writeChunk: (index: number, byteOffset: number, bytes: Uint8Array) => Promise<void>;
  finalize: (expectedSize: number, mimeType: string) => Promise<Blob>;
  dispose: () => Promise<void>;
}

interface OpfsWritableLike {
  write: (data: { type: 'write'; position: number; data: Uint8Array }) => Promise<void>;
  close: () => Promise<void>;
  abort?: () => Promise<void>;
}

interface OpfsFileHandleLike {
  createWritable: (options?: { keepExistingData?: boolean }) => Promise<OpfsWritableLike>;
  getFile: () => Promise<File>;
}

interface OpfsDirectoryLike {
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<OpfsFileHandleLike>;
  removeEntry: (name: string) => Promise<void>;
}

function sanitizePartFileName(key: string): string {
  const cleaned = key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return `bifrost-rx-${cleaned || 'transfer'}.part`;
}

/**
 * Creates a disk-backed Origin Private File System (OPFS) chunk sink when available so
 * multi-hundred-MB or GB files stream directly to disk instead of buffering in JS RAM.
 * Falls back transparently to an in-memory chunk Map when OPFS is unavailable.
 */
export async function createInboundChunkSink(
  transferKey: string,
  totalChunks: number,
): Promise<InboundChunkSink> {
  const storage = typeof navigator !== 'undefined' ? (navigator.storage as { getDirectory?: () => Promise<OpfsDirectoryLike> } | undefined) : undefined;
  if (storage && typeof storage.getDirectory === 'function') {
    let dir: OpfsDirectoryLike | null = null;
    const partName = sanitizePartFileName(transferKey);
    let writable: OpfsWritableLike | null = null;
    try {
      dir = await storage.getDirectory();
      const fileHandle = await dir.getFileHandle(partName, { create: true });
      writable = await fileHandle.createWritable({ keepExistingData: false });

      let closed = false;
      let removed = false;

      return {
        mode: 'disk-opfs',
        writeChunk: async (_index: number, byteOffset: number, bytes: Uint8Array) => {
          if (!writable || closed) throw new Error('Disk stream closed');
          await writable.write({ type: 'write', position: byteOffset, data: bytes });
        },
        finalize: async (expectedSize: number, mimeType: string) => {
          if (!writable) throw new Error('Disk stream missing');
          if (!closed) {
            await writable.close();
            closed = true;
          }
          const file = await fileHandle.getFile();
          if (file.size !== expectedSize) {
            throw new Error(`Disk file size mismatch: ${file.size} !== ${expectedSize}`);
          }
          // Slice preserves disk-backed File reference with the requested MIME type.
          return file.slice(0, file.size, mimeType || 'application/octet-stream');
        },
        dispose: async () => {
          if (writable && !closed) {
            closed = true;
            try {
              await writable.abort?.();
            } catch {
              try {
                await writable.close();
              } catch {
                /* Ignore close error during cleanup. */
              }
            }
          }
          if (dir && !removed) {
            removed = true;
            await dir.removeEntry(partName).catch(() => {});
          }
        },
      };
    } catch {
      if (writable) {
        await writable.abort?.().catch(() => {});
      }
      if (dir) {
        await dir.removeEntry(partName).catch(() => {});
      }
    }
  }

  const chunks = new Map<number, Uint8Array>();
  return {
    mode: 'memory',
    writeChunk: async (index: number, _byteOffset: number, bytes: Uint8Array) => {
      // Copy slice so subsequent views don't alias underlying DataChannel buffers.
      chunks.set(index, new Uint8Array(bytes));
    },
    finalize: async (expectedSize: number, mimeType: string) => {
      const blob = reassembleChunks(chunks, totalChunks, mimeType, { clearChunks: true });
      if (blob.size !== expectedSize) {
        throw new Error(`File size mismatch: ${blob.size} !== ${expectedSize}`);
      }
      return blob;
    },
    dispose: async () => {
      chunks.clear();
    },
  };
}

interface SaveFilePickerWindow {
  showSaveFilePicker?: (options?: { suggestedName?: string }) => Promise<{
    createWritable: () => Promise<WritableStream<Uint8Array>>;
  }>;
}

/**
 * Streams a Blob directly to a user-chosen disk path via `FileSystemWritableFileStream`
 * when supported (Chromium desktop), avoiding a second memory copy on save.
 */
export async function saveBlobWithFilePicker(
  blob: Blob,
  suggestedName: string,
): Promise<'saved' | 'cancelled' | 'unsupported'> {
  const pickerWin = typeof window !== 'undefined' ? (window as unknown as SaveFilePickerWindow) : null;
  if (!pickerWin || typeof pickerWin.showSaveFilePicker !== 'function') {
    return 'unsupported';
  }
  try {
    const handle = await pickerWin.showSaveFilePicker({ suggestedName });
    const writable = await handle.createWritable();
    await blob.stream().pipeTo(writable);
    return 'saved';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return 'cancelled';
    }
    return 'unsupported';
  }
}
