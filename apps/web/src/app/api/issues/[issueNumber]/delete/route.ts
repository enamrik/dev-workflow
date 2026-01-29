/**
 * DELETE /api/issues/[issueNumber]/delete
 *
 * Soft deletes an issue. Only PLANNED issues can be deleted.
 */

import { createApiEndpoint, createApiRoute } from "@/lib/di/bootstrap";
import { deleteIssueEndpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const endpoint = createApiEndpoint(deleteIssueEndpoint);

export const DELETE = createApiRoute(endpoint);
