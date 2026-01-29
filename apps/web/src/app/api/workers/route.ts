import { createApiEndpoint, createApiRoute } from "@/lib/di/bootstrap";
import { listWorkersEndpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const endpoint = createApiEndpoint(listWorkersEndpoint);
export const GET = createApiRoute(endpoint);
