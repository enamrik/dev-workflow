import { createApiRoute } from "@/lib/di/bootstrap";
import { listEndpoint, pruneEndpoint } from "./endpoint";

export { listEndpoint, pruneEndpoint };
export const dynamic = "force-dynamic";

export const GET = createApiRoute(listEndpoint);
export const POST = createApiRoute(pruneEndpoint);
