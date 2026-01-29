import { createApiEndpoint, createApiRoute } from "@/lib/di/bootstrap";
import { listMilestonesEndpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const endpoint = createApiEndpoint(listMilestonesEndpoint);
export const GET = createApiRoute(endpoint);
