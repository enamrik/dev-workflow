import { describe, it, expect } from "vitest";
import { shouldPrintVersionBanner } from "../version-banner.js";

describe("shouldPrintVersionBanner", () => {
  it("returns true for a normal verb", () => {
    expect(shouldPrintVersionBanner("workers")).toBe(true);
  });

  it("returns false for `version`", () => {
    expect(shouldPrintVersionBanner("version")).toBe(false);
  });

  it("returns false for `--version`", () => {
    expect(shouldPrintVersionBanner("--version")).toBe(false);
  });

  it("returns false for `-V`", () => {
    expect(shouldPrintVersionBanner("-V")).toBe(false);
  });

  it("returns false for `mcp`", () => {
    expect(shouldPrintVersionBanner("mcp")).toBe(false);
  });

  it("returns false for `--help`", () => {
    expect(shouldPrintVersionBanner("--help")).toBe(false);
  });

  it("returns false for `-h`", () => {
    expect(shouldPrintVersionBanner("-h")).toBe(false);
  });

  it("returns false for undefined (bare invocation)", () => {
    expect(shouldPrintVersionBanner(undefined)).toBe(false);
  });
});
