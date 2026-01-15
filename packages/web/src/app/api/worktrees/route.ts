import { createApiEndpoint, createApiRoute } from "@/lib/di/bootstrap";
import { listWorktreesEndpoint, pruneWorktreesEndpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const listEndpoint = createApiEndpoint(listWorktreesEndpoint);
export const pruneEndpoint = createApiEndpoint(pruneWorktreesEndpoint);

export const GET = createApiRoute(listEndpoint);
export const POST = createApiRoute(pruneEndpoint);
