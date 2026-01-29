/**
 * GET /api/projects
 *
 * Returns all available projects with their GitHub sync configuration.
 */

import { createApiEndpoint, createApiRoute } from "@/lib/di/bootstrap";
import { listProjectsEndpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const endpoint = createApiEndpoint(listProjectsEndpoint);

export const GET = createApiRoute(endpoint);
