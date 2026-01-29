import { createApiEndpoint, createApiRoute } from "@/lib/di/bootstrap";
import { getTaskDependenciesEndpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const endpoint = createApiEndpoint(getTaskDependenciesEndpoint);
export const GET = createApiRoute(endpoint);
