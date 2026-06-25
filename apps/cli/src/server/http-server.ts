/**
 * In-process HTTP + WebSocket API server for the CLI.
 *
 * - Serves the ported web API (routes.ts) under /api.
 * - Serves the static SPA bundle from assetsDir, with index.html fallback for
 *   client-side routes.
 * - Upgrades /ws connections to WebSocket via WebSocketHandler.
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { WebSocketServer } from "ws";
import type { AwilixContainer } from "awilix";
import { createRuntime } from "@dev-workflow/effect";
import { matchRoute } from "./routes.js";
import { WebSocketHandler } from "./websocket-handler.js";

export interface ApiServerHandle {
  close(): Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Build a WHATWG Request from a Node IncomingMessage.
 * The body (for non-GET/HEAD methods) is buffered to a string.
 */
async function toWebRequest(
  req: http.IncomingMessage,
  port: number,
  body: string | undefined
): Promise<Request> {
  const url = `http://127.0.0.1:${port}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  const method = req.method ?? "GET";
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD" && body !== undefined) {
    init.body = body;
  }
  return new Request(url, init);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Write a WHATWG Response to a Node ServerResponse.
 */
async function writeWebResponse(res: http.ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

/**
 * Resolve a request path to a file inside assetsDir, guarding against traversal.
 * Returns null if the resolved path escapes assetsDir.
 */
function resolveAssetPath(assetsDir: string, pathname: string): string | null {
  const decoded = decodeURIComponent(pathname);
  const requested = path.normalize(path.join(assetsDir, decoded));
  const root = path.resolve(assetsDir);
  if (requested !== root && !requested.startsWith(root + path.sep)) {
    return null;
  }
  return requested;
}

async function serveStatic(
  res: http.ServerResponse,
  assetsDir: string,
  pathname: string
): Promise<void> {
  const indexPath = path.join(assetsDir, "index.html");

  if (!fs.existsSync(assetsDir)) {
    sendJson(res, 503, { error: "UI assets are not installed" });
    return;
  }

  const candidate = resolveAssetPath(assetsDir, pathname === "/" ? "/index.html" : pathname);
  if (candidate === null) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    const stat = await fsp.stat(candidate);
    if (stat.isFile()) {
      const data = await fsp.readFile(candidate);
      res.writeHead(200, { "content-type": contentTypeFor(candidate) });
      res.end(data);
      return;
    }
  } catch {
    // Fall through to SPA fallback handling below.
  }

  // SPA fallback: paths without a file extension serve index.html.
  if (path.extname(pathname) === "" && fs.existsSync(indexPath)) {
    const data = await fsp.readFile(indexPath);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(data);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

export async function startApiServer(opts: {
  container: AwilixContainer;
  port: number;
  assetsDir: string;
}): Promise<ApiServerHandle> {
  const { container, port, assetsDir } = opts;

  const wsHandler = new WebSocketHandler();
  const wss = new WebSocketServer({ noServer: true });

  const server = http.createServer((req, res) => {
    void handleRequest(req, res).catch((error) => {
      if (!res.headersSent) {
        sendJson(res, 500, {
          error: error instanceof Error ? error.message : "Internal server error",
        });
      } else {
        res.end();
      }
    });
  });

  async function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const requestUrl = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const pathname = requestUrl.pathname;
    const method = req.method ?? "GET";

    if (pathname.startsWith("/api")) {
      const match = matchRoute(method, pathname);
      if (!match) {
        sendJson(res, 404, { error: "Not found" });
        return;
      }

      const needsBody = method !== "GET" && method !== "HEAD";
      const body = needsBody ? await readBody(req) : undefined;
      const webRequest = await toWebRequest(req, port, body);

      if (match.program.middleware) {
        await match.program.middleware(container);
      }

      const runtime = createRuntime(container);
      const response = await runtime.runEffectAndUnwrap(
        match.program.run(webRequest, match.params)
      );
      await writeWebResponse(res, response);
      return;
    }

    await serveStatic(res, assetsDir, pathname);
  }

  server.on("upgrade", (req, socket, head) => {
    const requestUrl = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (requestUrl.pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wsHandler.handleConnection(ws);
      });
    } else {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", onError);
      resolve();
    });
  });

  return {
    close: async (): Promise<void> => {
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
      for (const client of wss.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
