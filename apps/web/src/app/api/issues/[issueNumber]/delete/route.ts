/**
 * DELETE /api/issues/[issueNumber]/delete
 *
 * Soft deletes an issue. Only PLANNED issues can be deleted.
 */

import { createApiRoute } from "@/lib/di/bootstrap";
import { endpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const DELETE = createApiRoute(endpoint);
