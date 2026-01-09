/**
 * Mock ClaudeConfigService
 *
 * A mock implementation for testing code that depends on ClaudeConfigService.
 */

import type {
  ClaudeConfigService,
  ClaudeConfigCleanupResult,
} from "../../infrastructure/claude/claude-config-service.js";

/**
 * Configuration for MockClaudeConfigService
 */
export interface MockClaudeConfigServiceConfig {
  /**
   * Folders that should exist in the mock config.
   * When removeFolder is called, these are checked.
   */
  existingFolders?: string[];

  /**
   * If true, removeFolder will throw an error
   */
  shouldError?: boolean;

  /**
   * Custom error message when shouldError is true
   */
  errorMessage?: string;
}

/**
 * Represents a call made to the mock
 */
export interface MockClaudeConfigServiceCall {
  method: "removeFolder";
  args: [string];
  timestamp: Date;
}

/**
 * Mock implementation of ClaudeConfigService for testing
 */
export class MockClaudeConfigService implements ClaudeConfigService {
  private existingFolders: Set<string>;
  private shouldError: boolean;
  private errorMessage: string;
  private _calls: MockClaudeConfigServiceCall[] = [];

  constructor(config: MockClaudeConfigServiceConfig = {}) {
    this.existingFolders = new Set(config.existingFolders ?? []);
    this.shouldError = config.shouldError ?? false;
    this.errorMessage = config.errorMessage ?? "Mock error";
  }

  /**
   * Get all calls made to this mock
   */
  get calls(): MockClaudeConfigServiceCall[] {
    return [...this._calls];
  }

  /**
   * Reset the mock state
   */
  reset(): void {
    this._calls = [];
  }

  /**
   * Add a folder to the mock config
   */
  addFolder(folderPath: string): void {
    this.existingFolders.add(folderPath);
  }

  async removeFolder(folderPath: string): Promise<ClaudeConfigCleanupResult> {
    this._calls.push({
      method: "removeFolder",
      args: [folderPath],
      timestamp: new Date(),
    });

    if (this.shouldError) {
      throw new Error(this.errorMessage);
    }

    if (this.existingFolders.has(folderPath)) {
      this.existingFolders.delete(folderPath);
      return {
        success: true,
        folderRemoved: true,
        message: `Removed folder from Claude config: ${folderPath}`,
      };
    }

    return {
      success: true,
      folderRemoved: false,
      message: `Folder not found in Claude config: ${folderPath}`,
    };
  }
}
