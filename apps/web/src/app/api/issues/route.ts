/**
 * GET /api/issues
 *
 * Returns all issues across projects with plan info and computed status.
 */

import { createApiRoute } from "@/lib/di/bootstrap";
import { endpoint } from "./endpoint";

export { endpoint };
export const dynamic = "force-dynamic";

export const GET = createApiRoute(endpoint);
