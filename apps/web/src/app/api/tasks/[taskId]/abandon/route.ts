import { createApiEndpoint, createApiRoute } from "@/lib/di/bootstrap";
import { abandonTaskEndpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const endpoint = createApiEndpoint(abandonTaskEndpoint);
export const POST = createApiRoute(endpoint);
