/**
 * GET /api/issues
 *
 * Returns all issues across projects with plan info and computed status.
 */

import { createApiEndpoint, createApiRoute } from "@/lib/di/bootstrap";
import { listIssuesEndpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const endpoint = createApiEndpoint(listIssuesEndpoint);

export const GET = createApiRoute(endpoint);
