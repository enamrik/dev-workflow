/**
 * Dependency Injection exports for the web package
 */

// Container and cradle types
export { getWebContainer, buildWebContainer, type WebCradle } from "./container";

// Bootstrap utilities
export { createApiEndpoint, createApiRoute, jsonBody } from "./bootstrap";

// Test utilities
export { createTestContainer, createTestRequest, runTestEndpoint } from "./test-utils";
