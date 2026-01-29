import { createApiEndpoint, createApiRoute } from "@/lib/di/bootstrap";
import { getProjectEndpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const endpoint = createApiEndpoint(getProjectEndpoint);
export const GET = createApiRoute(endpoint);
