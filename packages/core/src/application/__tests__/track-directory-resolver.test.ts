import { describe, it, expect, afterEach } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import {
  resolveGlobalTrackDir,
  getGlobalDatabasePath,
  getTrackDirectoryForProject,
  TrackDirectoryResolver,
} from "../track-directory-resolver.js";

describe("track-directory-resolver", () => {
  const originalEnv = process.env["TRACK_DIR"];

  afterEach(() => {
    // Restore original environment
    if (originalEnv === undefined) {
      delete process.env["TRACK_DIR"];
    } else {
      process.env["TRACK_DIR"] = originalEnv;
    }
  });

  describe("resolveGlobalTrackDir", () => {
    it("should return ~/.track when TRACK_DIR is not set", () => {
      delete process.env["TRACK_DIR"];

      const result = resolveGlobalTrackDir();

      expect(result).toBe(path.join(os.homedir(), ".track"));
    });

    it("should return TRACK_DIR when set", () => {
      process.env["TRACK_DIR"] = "/custom/track/dir";

      const result = resolveGlobalTrackDir();

      expect(result).toBe("/custom/track/dir");
    });

    it("should resolve relative TRACK_DIR to absolute path", () => {
      process.env["TRACK_DIR"] = "./local-track";

      const result = resolveGlobalTrackDir();

      expect(path.isAbsolute(result)).toBe(true);
      expect(result).toBe(path.resolve("./local-track"));
    });
  });

  describe("getGlobalDatabasePath", () => {
    it("should return ~/.track/workflow.db when TRACK_DIR is not set", () => {
      delete process.env["TRACK_DIR"];

      const result = getGlobalDatabasePath();

      expect(result).toBe(path.join(os.homedir(), ".track", "workflow.db"));
    });

    it("should return $TRACK_DIR/workflow.db when TRACK_DIR is set", () => {
      process.env["TRACK_DIR"] = "/custom/track/dir";

      const result = getGlobalDatabasePath();

      expect(result).toBe("/custom/track/dir/workflow.db");
    });
  });

  describe("getTrackDirectoryForProject", () => {
    it("should return ~/.track/projects/<projectId> when TRACK_DIR is not set", () => {
      delete process.env["TRACK_DIR"];

      const result = getTrackDirectoryForProject("my-project-abc123");

      expect(result).toBe(path.join(os.homedir(), ".track", "projects", "my-project-abc123"));
    });

    it("should return $TRACK_DIR/projects/<projectId> when TRACK_DIR is set", () => {
      process.env["TRACK_DIR"] = "/custom/track/dir";

      const result = getTrackDirectoryForProject("my-project-abc123");

      expect(result).toBe("/custom/track/dir/projects/my-project-abc123");
    });
  });

  describe("TrackDirectoryResolver", () => {
    const gitRoot = "/path/to/my-repo";

    describe("getGlobalTrackDirectory", () => {
      it("should return ~/.track when TRACK_DIR is not set", () => {
        delete process.env["TRACK_DIR"];
        const resolver = new TrackDirectoryResolver(gitRoot);

        const result = resolver.getGlobalTrackDirectory();

        expect(result).toBe(path.join(os.homedir(), ".track"));
      });

      it("should return TRACK_DIR when set", () => {
        process.env["TRACK_DIR"] = "/custom/track/dir";
        const resolver = new TrackDirectoryResolver(gitRoot);

        const result = resolver.getGlobalTrackDirectory();

        expect(result).toBe("/custom/track/dir");
      });
    });

    describe("getTrackDirectory", () => {
      it("should return ~/.track/projects/<projectId> when TRACK_DIR is not set", () => {
        delete process.env["TRACK_DIR"];
        const resolver = new TrackDirectoryResolver(gitRoot);
        const projectId = resolver.getProjectId();

        const result = resolver.getTrackDirectory();

        expect(result).toBe(path.join(os.homedir(), ".track", "projects", projectId));
      });

      it("should return $TRACK_DIR/projects/<projectId> when TRACK_DIR is set", () => {
        process.env["TRACK_DIR"] = "/custom/track/dir";
        const resolver = new TrackDirectoryResolver(gitRoot);
        const projectId = resolver.getProjectId();

        const result = resolver.getTrackDirectory();

        expect(result).toBe(path.join("/custom/track/dir", "projects", projectId));
      });
    });

    describe("getDatabasePath", () => {
      it("should return ~/.track/workflow.db when TRACK_DIR is not set", () => {
        delete process.env["TRACK_DIR"];
        const resolver = new TrackDirectoryResolver(gitRoot);

        const result = resolver.getDatabasePath();

        expect(result).toBe(path.join(os.homedir(), ".track", "workflow.db"));
      });

      it("should return $TRACK_DIR/workflow.db when TRACK_DIR is set", () => {
        process.env["TRACK_DIR"] = "/custom/track/dir";
        const resolver = new TrackDirectoryResolver(gitRoot);

        const result = resolver.getDatabasePath();

        expect(result).toBe("/custom/track/dir/workflow.db");
      });
    });

    describe("fromProjectId", () => {
      it("should respect TRACK_DIR when creating resolver from project ID", () => {
        process.env["TRACK_DIR"] = "/custom/track/dir";
        const resolver = TrackDirectoryResolver.fromProjectId("test-project-123456");

        const result = resolver.getTrackDirectory();

        expect(result).toBe("/custom/track/dir/projects/test-project-123456");
      });
    });
  });
});
