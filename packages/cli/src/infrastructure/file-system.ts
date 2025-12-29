import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";

export interface FileSystem {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  copyFile(source: string, destination: string): Promise<void>;
  copyDirectory(source: string, destination: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  readdirWithFileTypes(path: string): Promise<Dirent[]>;
  exists(path: string): Promise<boolean>;
}

export class NodeFileSystem implements FileSystem {
  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(dirPath, options);
  }

  async copyFile(source: string, destination: string): Promise<void> {
    await fs.copyFile(source, destination);
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await fs.writeFile(filePath, content, "utf-8");
  }

  async readFile(filePath: string): Promise<string> {
    return await fs.readFile(filePath, "utf-8");
  }

  async readdirWithFileTypes(dirPath: string): Promise<Dirent[]> {
    return await fs.readdir(dirPath, { withFileTypes: true });
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async copyDirectory(source: string, destination: string): Promise<void> {
    await this.mkdir(destination, { recursive: true });
    const entries = await this.readdirWithFileTypes(source);

    for (const entry of entries) {
      const sourcePath = path.join(source, entry.name);
      const destPath = path.join(destination, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(sourcePath, destPath);
      } else {
        await this.copyFile(sourcePath, destPath);
      }
    }
  }
}
