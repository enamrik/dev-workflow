/**
 * POST /api/issues/[issueNumber]/move-to-backlog
 *
 * Activates a PLANNED issue to OPEN and transitions PLANNED tasks to BACKLOG.
 */

import { createApiRoute } from "@/lib/di/bootstrap";
import { endpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const POST = createApiRoute(endpoint);
