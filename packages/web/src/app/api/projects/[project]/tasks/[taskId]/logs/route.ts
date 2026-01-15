import { createApiEndpoint, createApiRoute } from "@/lib/di/bootstrap";
import { getTaskExecutionLogsEndpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const endpoint = createApiEndpoint(getTaskExecutionLogsEndpoint);
export const GET = createApiRoute(endpoint);
