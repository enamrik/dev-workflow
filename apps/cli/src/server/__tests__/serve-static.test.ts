import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "node:http";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { serveStatic } from "../http-server.js";

/**
 * Minimal fake ServerResponse capturing status + body written by serveStatic.
 * serveStatic only uses writeHead(status, headers) + end(data).
 */
function fakeRes(): http.ServerResponse & { _status: number; _body: string } {
  const res = {
    _status: 0,
    _body: "",
    writeHead(status: number) {
      (this as { _status: number })._status = status;
      return this;
    },
    end(data?: unknown) {
      if (data != null)
        (this as { _body: string })._body = Buffer.isBuffer(data)
          ? data.toString("utf8")
          : String(data);
    },
  };
  return res as unknown as http.ServerResponse & { _status: number; _body: string };
}

describe("serveStatic (Next static-export route resolution)", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "dfl-static-"));
    await fsp.writeFile(path.join(dir, "index.html"), "KANBAN_ROOT");
    await fsp.writeFile(path.join(dir, "milestones.html"), "MILESTONES_PAGE");
    await fsp.mkdir(path.join(dir, "milestones")); // the route DIRECTORY (no index.html inside)
    await fsp.mkdir(path.join(dir, "_next"), { recursive: true });
    await fsp.writeFile(path.join(dir, "_next", "app.js"), "console.log(1)");
  });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("serves <route>.html for an extensionless route (regression: refresh on /milestones showed Kanban)", async () => {
    const res = fakeRes();
    await serveStatic(res, dir, "/milestones");
    expect(res._status).toBe(200);
    expect(res._body).toBe("MILESTONES_PAGE");
    expect(res._body).not.toBe("KANBAN_ROOT");
  });

  it("handles a trailing slash on the route", async () => {
    const res = fakeRes();
    await serveStatic(res, dir, "/milestones/");
    expect(res._body).toBe("MILESTONES_PAGE");
  });

  it("serves index.html at the root", async () => {
    const res = fakeRes();
    await serveStatic(res, dir, "/");
    expect(res._body).toBe("KANBAN_ROOT");
  });

  it("falls back to index.html for an extensionless route with no per-route file", async () => {
    const res = fakeRes();
    await serveStatic(res, dir, "/projects/some-id/issues/1");
    expect(res._status).toBe(200);
    expect(res._body).toBe("KANBAN_ROOT");
  });

  it("serves static assets directly", async () => {
    const res = fakeRes();
    await serveStatic(res, dir, "/_next/app.js");
    expect(res._status).toBe(200);
    expect(res._body).toBe("console.log(1)");
  });
});
