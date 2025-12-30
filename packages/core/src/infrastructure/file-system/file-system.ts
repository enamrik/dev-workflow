import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";

export interface FileSystem {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
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

  async readdirWithFileTypes(dirPath: string): Promise<Dirent[]> {
    return await fs.readdir(dirPath, { withFileTypes: true });
  }
}
