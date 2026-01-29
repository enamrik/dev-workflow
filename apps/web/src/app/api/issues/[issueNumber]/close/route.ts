/**
 * POST /api/issues/[issueNumber]/close
 *
 * Closes an issue and abandons any incomplete tasks.
 */

import { createApiEndpoint, createApiRoute } from "@/lib/di/bootstrap";
import { closeIssueEndpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const endpoint = createApiEndpoint(closeIssueEndpoint);

export const POST = createApiRoute(endpoint);
