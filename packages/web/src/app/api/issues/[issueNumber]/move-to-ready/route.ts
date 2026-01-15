/**
 * POST /api/issues/[issueNumber]/move-to-ready
 *
 * Moves all BACKLOG tasks to READY status for an OPEN issue.
 */

import { createApiEndpoint, createApiRoute } from "@/lib/di/bootstrap";
import { moveToReadyEndpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const endpoint = createApiEndpoint(moveToReadyEndpoint);

export const POST = createApiRoute(endpoint);
