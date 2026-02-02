/**
 * POST /api/tasks/[taskId]/transition
 *
 * Transitions a task to a new status with full validation.
 */

import { createApiRoute } from "@/lib/di/bootstrap";
import { endpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const POST = createApiRoute(endpoint);
