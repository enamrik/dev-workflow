/**
 * GET /api/projects
 *
 * Returns all available projects with their GitHub sync configuration.
 */

import { createApiRoute } from "@/lib/di/bootstrap";
import { endpoint } from "./endpoint";

export { endpoint };
export const dynamic = "force-dynamic";

export const GET = createApiRoute(endpoint);
