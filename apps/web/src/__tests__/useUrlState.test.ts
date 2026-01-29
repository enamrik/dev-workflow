import { describe, expect, it } from "vitest";

/**
 * Tests for URL state encoding/decoding functions.
 * These are the pure functions used by useUrlState hook.
 */

interface UrlState {
  project?: string;
  showBacklog?: boolean;
}

/**
 * Encode state object to URL-safe base64 string.
 */
function encodeState(state: UrlState): string | undefined {
  const cleaned = Object.fromEntries(Object.entries(state).filter(([, v]) => v !== undefined));
  if (Object.keys(cleaned).length === 0) {
    return undefined;
  }
  const json = JSON.stringify(cleaned);
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode URL-safe base64 string to state object.
 */
function decodeState(encoded: string): UrlState {
  try {
    let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padding = base64.length % 4;
    if (padding) {
      base64 += "=".repeat(4 - padding);
    }
    const json = atob(base64);
    return JSON.parse(json) as UrlState;
  } catch {
    return {};
  }
}

describe("URL state encoding/decoding", () => {
  describe("encodeState", () => {
    it("encodes state with project", () => {
      const state: UrlState = { project: "dev-workflow-b9bccf" };
      const encoded = encodeState(state);

      expect(encoded).toBeDefined();
      expect(encoded).not.toContain("+");
      expect(encoded).not.toContain("/");
      expect(encoded).not.toContain("=");
    });

    it("encodes state with showBacklog", () => {
      const state: UrlState = { showBacklog: true };
      const encoded = encodeState(state);

      expect(encoded).toBeDefined();
    });

    it("encodes state with both properties", () => {
      const state: UrlState = { project: "my-project", showBacklog: true };
      const encoded = encodeState(state);

      expect(encoded).toBeDefined();
    });

    it("returns undefined for empty state", () => {
      const state: UrlState = {};
      const encoded = encodeState(state);

      expect(encoded).toBeUndefined();
    });

    it("returns undefined for state with only undefined values", () => {
      const state: UrlState = { project: undefined, showBacklog: undefined };
      const encoded = encodeState(state);

      expect(encoded).toBeUndefined();
    });
  });

  describe("decodeState", () => {
    it("decodes encoded state with project", () => {
      const original: UrlState = { project: "dev-workflow-b9bccf" };
      const encoded = encodeState(original)!;
      const decoded = decodeState(encoded);

      expect(decoded).toEqual(original);
    });

    it("decodes encoded state with showBacklog", () => {
      const original: UrlState = { showBacklog: true };
      const encoded = encodeState(original)!;
      const decoded = decodeState(encoded);

      expect(decoded).toEqual(original);
    });

    it("decodes encoded state with both properties", () => {
      const original: UrlState = { project: "my-project", showBacklog: true };
      const encoded = encodeState(original)!;
      const decoded = decodeState(encoded);

      expect(decoded).toEqual(original);
    });

    it("returns empty object for invalid encoded string", () => {
      const decoded = decodeState("not-valid-base64!!!");

      expect(decoded).toEqual({});
    });

    it("returns empty object for empty string", () => {
      const decoded = decodeState("");

      expect(decoded).toEqual({});
    });

    it("handles special characters in project names", () => {
      const original: UrlState = { project: "project-with-dashes" };
      const encoded = encodeState(original)!;
      const decoded = decodeState(encoded);

      expect(decoded).toEqual(original);
    });
  });

  describe("roundtrip", () => {
    it("preserves state through encode/decode cycle", () => {
      const testCases: UrlState[] = [
        { project: "simple" },
        { showBacklog: true },
        { showBacklog: false },
        { project: "complex-project-name-123", showBacklog: true },
        { project: "" }, // Empty string is still a valid value
      ];

      for (const original of testCases) {
        const encoded = encodeState(original)!;
        const decoded = decodeState(encoded);
        expect(decoded).toEqual(original);
      }
    });
  });
});
