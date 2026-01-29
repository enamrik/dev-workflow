import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";

export interface FileSystem {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  unlink(path: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdirWithFileTypes(path: string): Promise<Dirent[]>;
}

export class NodeFileSystem implements FileSystem {
  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async readFile(filePath: string): Promise<string> {
    return await fs.readFile(filePath, "utf-8");
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await fs.writeFile(filePath, content, "utf-8");
  }

  async unlink(filePath: string): Promise<void> {
    await fs.unlink(filePath);
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(dirPath, options);
  }

  async readdirWithFileTypes(dirPath: string): Promise<Dirent[]> {
    return await fs.readdir(dirPath, { withFileTypes: true });
  }
}
