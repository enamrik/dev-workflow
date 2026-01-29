/**
 * POST /api/issues/[issueNumber]/move-to-backlog
 *
 * Activates a PLANNED issue to OPEN and transitions PLANNED tasks to BACKLOG.
 */

import { createApiEndpoint, createApiRoute } from "@/lib/di/bootstrap";
import { moveToBacklogEndpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const endpoint = createApiEndpoint(moveToBacklogEndpoint);

export const POST = createApiRoute(endpoint);
