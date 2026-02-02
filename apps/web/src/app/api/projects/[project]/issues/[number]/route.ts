/**
 * GET /api/projects/[project]/issues/[number]
 *
 * Returns an issue with its plan and tasks.
 */

import { createApiRoute } from "@/lib/di/bootstrap";
import { endpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const GET = createApiRoute(endpoint);
