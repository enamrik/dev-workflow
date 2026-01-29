/**
 * Dependency Injection exports for the web package
 */

// Container and cradle types
export { getWebContainer, buildWebContainer, type WebCradle } from "./container";

// Bootstrap utilities
export {
  parseJsonBody,
  createApiEndpoint,
  createApiRoute,
  type Endpoint,
  type ApiMiddleware,
} from "./bootstrap";

// Test utilities
export { buildTestContainer, runTestApiEndpoint } from "./test-utils";
