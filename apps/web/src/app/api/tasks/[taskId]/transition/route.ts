import { createApiEndpoint, createApiRoute } from "@/lib/di/bootstrap";
import { transitionTaskEndpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const endpoint = createApiEndpoint(transitionTaskEndpoint);
export const POST = createApiRoute(endpoint);
