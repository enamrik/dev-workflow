/**
 * Dependency Injection Infrastructure
 *
 * This module provides the foundational DI infrastructure for all packages:
 * - Container building with ContainerBuilder
 * - Middleware composition with compose()
 * - Error mapping with mapError()
 *
 * @example
 * ```typescript
 * import {
 *   ContainerBuilder,
 *   compose,
 *   createEndpoint,
 *   mapError,
 * } from '@dev-workflow/core/infrastructure/di';
 * ```
 */

export * from "./container.js";
export * from "./compose.js";
export * from "./map-error.js";
