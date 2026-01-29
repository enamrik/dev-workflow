import { createApiEndpoint, createApiRoute } from "@/lib/di/bootstrap";
import { getTaskStatusHistoryEndpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const endpoint = createApiEndpoint(getTaskStatusHistoryEndpoint);
export const GET = createApiRoute(endpoint);
