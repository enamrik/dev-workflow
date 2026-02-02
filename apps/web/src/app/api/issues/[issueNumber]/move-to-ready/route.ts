/**
 * POST /api/issues/[issueNumber]/move-to-ready
 *
 * Moves all BACKLOG tasks to READY status for an OPEN issue.
 */

import { createApiRoute } from "@/lib/di/bootstrap";
import { endpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const POST = createApiRoute(endpoint);
