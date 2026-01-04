import * as fs from "node:fs/promises";
import * as path from "node:path";
export class NodeFileSystem {
  async mkdir(dirPath, options) {
    await fs.mkdir(dirPath, options);
  }
  async rmdir(dirPath, options) {
    await fs.rm(dirPath, options);
  }
  async copyFile(source, destination) {
    await fs.copyFile(source, destination);
  }
  async writeFile(filePath, content) {
    await fs.writeFile(filePath, content, "utf-8");
  }
  async readFile(filePath) {
    return await fs.readFile(filePath, "utf-8");
  }
  async readdirWithFileTypes(dirPath) {
    return await fs.readdir(dirPath, { withFileTypes: true });
  }
  async exists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
  async copyDirectory(source, destination) {
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
//# sourceMappingURL=file-system.js.map
