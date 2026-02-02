/**
 * POST /api/issues/[issueNumber]/close
 *
 * Closes an issue and abandons any incomplete tasks.
 */

import { createApiRoute } from "@/lib/di/bootstrap";
import { endpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const POST = createApiRoute(endpoint);
