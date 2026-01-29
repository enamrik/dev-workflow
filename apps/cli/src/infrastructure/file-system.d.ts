import type { Dirent } from "node:fs";
export interface FileSystem {
    mkdir(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    rmdir(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    copyFile(source: string, destination: string): Promise<void>;
    copyDirectory(source: string, destination: string): Promise<void>;
    writeFile(path: string, content: string): Promise<void>;
    readFile(path: string): Promise<string>;
    readdirWithFileTypes(path: string): Promise<Dirent[]>;
    exists(path: string): Promise<boolean>;
}
export declare class NodeFileSystem implements FileSystem {
    mkdir(dirPath: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    rmdir(dirPath: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    copyFile(source: string, destination: string): Promise<void>;
    writeFile(filePath: string, content: string): Promise<void>;
    readFile(filePath: string): Promise<string>;
    readdirWithFileTypes(dirPath: string): Promise<Dirent[]>;
    exists(filePath: string): Promise<boolean>;
    copyDirectory(source: string, destination: string): Promise<void>;
}
//# sourceMappingURL=file-system.d.ts.map