/**
 * Mock File System for testing
 *
 * Provides an in-memory implementation of the FileSystem interface.
 * All file operations work on an in-memory virtual filesystem.
 */

import type { Dirent } from "node:fs";
import type { FileSystem } from "../../infrastructure/file-system/file-system.js";

/**
 * Recorded call to the mock file system
 */
export interface MockFileSystemCall {
  method: string;
  args: unknown[];
  timestamp: Date;
}

/**
 * In-memory file entry
 */
interface MockFile {
  content: string;
  isDirectory: boolean;
}

/**
 * Mock Dirent for readdirWithFileTypes
 */
class MockDirent implements Dirent {
  readonly parentPath: string;
  readonly path: string;

  constructor(
    public readonly name: string,
    private readonly _isDirectory: boolean,
    parentPath: string
  ) {
    this.parentPath = parentPath;
    this.path = `${parentPath}/${name}`;
  }

  isFile(): boolean {
    return !this._isDirectory;
  }
  isDirectory(): boolean {
    return this._isDirectory;
  }
  isBlockDevice(): boolean {
    return false;
  }
  isCharacterDevice(): boolean {
    return false;
  }
  isSymbolicLink(): boolean {
    return false;
  }
  isFIFO(): boolean {
    return false;
  }
  isSocket(): boolean {
    return false;
  }
}

/**
 * Mock implementation of FileSystem for testing
 *
 * Features:
 * - In-memory virtual filesystem
 * - Records all method calls for verification
 * - Supports files and directories
 * - Can be pre-populated with initial files
 */
export class MockFileSystem implements FileSystem {
  private files: Map<string, MockFile> = new Map();
  private calls: MockFileSystemCall[] = [];

  /**
   * Create a mock file system, optionally with initial files
   *
   * @param initialFiles - Map of path to content for initial files
   */
  constructor(initialFiles?: Record<string, string>) {
    if (initialFiles) {
      for (const [path, content] of Object.entries(initialFiles)) {
        this.addFile(path, content);
      }
    }
  }

  /**
   * Add a file to the virtual filesystem
   */
  addFile(path: string, content: string): void {
    // Ensure parent directories exist
    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (let i = 0; i < parts.length - 1; i++) {
      current += "/" + parts[i];
      if (!this.files.has(current)) {
        this.files.set(current, { content: "", isDirectory: true });
      }
    }

    this.files.set(this.normalizePath(path), { content, isDirectory: false });
  }

  /**
   * Add a directory to the virtual filesystem
   */
  addDirectory(path: string): void {
    const normalized = this.normalizePath(path);

    // Ensure parent directories exist
    const parts = normalized.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current += "/" + part;
      if (!this.files.has(current)) {
        this.files.set(current, { content: "", isDirectory: true });
      }
    }
  }

  /**
   * Get a file's content (for test verification)
   */
  getFile(path: string): string | undefined {
    const file = this.files.get(this.normalizePath(path));
    return file?.isDirectory ? undefined : file?.content;
  }

  /**
   * Check if a path exists in the virtual filesystem
   */
  hasPath(path: string): boolean {
    return this.files.has(this.normalizePath(path));
  }

  /**
   * Get all recorded calls
   */
  getCalls(): MockFileSystemCall[] {
    return [...this.calls];
  }

  /**
   * Get calls to a specific method
   */
  getCallsTo(method: keyof FileSystem): MockFileSystemCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  /**
   * Clear recorded calls
   */
  clearCalls(): void {
    this.calls = [];
  }

  /**
   * Reset all state (files and calls)
   */
  reset(): void {
    this.files.clear();
    this.calls = [];
  }

  private normalizePath(path: string): string {
    // Normalize path separators and remove trailing slashes
    return path.replace(/\\/g, "/").replace(/\/+$/, "");
  }

  private recordCall(method: string, args: unknown[]): void {
    this.calls.push({ method, args, timestamp: new Date() });
  }

  async exists(path: string): Promise<boolean> {
    this.recordCall("exists", [path]);
    return this.files.has(this.normalizePath(path));
  }

  async readFile(path: string): Promise<string> {
    this.recordCall("readFile", [path]);

    const normalized = this.normalizePath(path);
    const file = this.files.get(normalized);

    if (!file) {
      const error = new Error(`ENOENT: no such file or directory, open '${path}'`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }

    if (file.isDirectory) {
      const error = new Error(`EISDIR: illegal operation on a directory, read`) as NodeJS.ErrnoException;
      error.code = "EISDIR";
      throw error;
    }

    return file.content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.recordCall("writeFile", [path, content]);

    const normalized = this.normalizePath(path);

    // Check parent directory exists
    const parentPath = normalized.substring(0, normalized.lastIndexOf("/"));
    if (parentPath && !this.files.has(parentPath)) {
      const error = new Error(`ENOENT: no such file or directory, open '${path}'`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }

    this.files.set(normalized, { content, isDirectory: false });
  }

  async unlink(path: string): Promise<void> {
    this.recordCall("unlink", [path]);

    const normalized = this.normalizePath(path);
    const file = this.files.get(normalized);

    if (!file) {
      const error = new Error(`ENOENT: no such file or directory, unlink '${path}'`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }

    if (file.isDirectory) {
      const error = new Error(`EISDIR: illegal operation on a directory, unlink '${path}'`) as NodeJS.ErrnoException;
      error.code = "EISDIR";
      throw error;
    }

    this.files.delete(normalized);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.recordCall("mkdir", [path, options]);

    const normalized = this.normalizePath(path);

    if (options?.recursive) {
      // Create all parent directories
      this.addDirectory(normalized);
    } else {
      // Check parent exists
      const parentPath = normalized.substring(0, normalized.lastIndexOf("/"));
      if (parentPath && !this.files.has(parentPath)) {
        const error = new Error(`ENOENT: no such file or directory, mkdir '${path}'`) as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }

      if (this.files.has(normalized)) {
        const error = new Error(`EEXIST: file already exists, mkdir '${path}'`) as NodeJS.ErrnoException;
        error.code = "EEXIST";
        throw error;
      }

      this.files.set(normalized, { content: "", isDirectory: true });
    }
  }

  async readdirWithFileTypes(path: string): Promise<Dirent[]> {
    this.recordCall("readdirWithFileTypes", [path]);

    const normalized = this.normalizePath(path);
    const dir = this.files.get(normalized);

    if (!dir) {
      const error = new Error(`ENOENT: no such file or directory, scandir '${path}'`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }

    if (!dir.isDirectory) {
      const error = new Error(`ENOTDIR: not a directory, scandir '${path}'`) as NodeJS.ErrnoException;
      error.code = "ENOTDIR";
      throw error;
    }

    const entries: Dirent[] = [];
    const prefix = normalized + "/";

    for (const [filePath, file] of this.files) {
      // Check if this is a direct child of the directory
      if (filePath.startsWith(prefix)) {
        const relativePath = filePath.substring(prefix.length);
        // Only include direct children (no further slashes)
        if (!relativePath.includes("/")) {
          entries.push(new MockDirent(relativePath, file.isDirectory, normalized));
        }
      }
    }

    return entries;
  }
}
