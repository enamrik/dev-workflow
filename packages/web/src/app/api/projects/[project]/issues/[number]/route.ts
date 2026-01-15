import { createApiEndpoint, createApiRoute } from "@/lib/di/bootstrap";
import { getIssueWithDetailsEndpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const endpoint = createApiEndpoint(getIssueWithDetailsEndpoint);
export const GET = createApiRoute(endpoint);
