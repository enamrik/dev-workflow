/**
 * React DI Context Provider and Hooks
 *
 * Provides dependency injection for React/Ink commands (like board).
 * Components access dependencies via hooks without prop drilling.
 *
 * Usage:
 * ```tsx
 * // In command runner
 * <DIContainerProvider container={container}>
 *   <BoardApp />
 * </DIContainerProvider>
 *
 * // In component
 * function BoardApp() {
 *   const projectsResolver = useDeps('projectsResolver');
 *   // ...
 * }
 * ```
 */

import React, { createContext, useContext, type ReactNode } from "react";
import type { AwilixContainer } from "awilix";
import type { CliCradle } from "./container.js";

/**
 * Context for the DI container
 */
const DIContainerContext = createContext<AwilixContainer<CliCradle> | null>(null);

/**
 * Props for DIContainerProvider
 */
export interface DIContainerProviderProps {
  /** The Awilix container instance */
  container: AwilixContainer<CliCradle>;
  /** React children */
  children: ReactNode;
}

/**
 * Provider component that makes the DI container available to all child components.
 *
 * Wrap your React/Ink app root with this provider to enable dependency access
 * via the useContainer() and useDeps() hooks.
 */
export function DIContainerProvider({
  container,
  children,
}: DIContainerProviderProps): React.ReactElement {
  return <DIContainerContext.Provider value={container}>{children}</DIContainerContext.Provider>;
}

/**
 * Hook to access the raw Awilix container.
 *
 * Use this when you need access to the full container API (e.g., createScope).
 * For most cases, prefer useDeps() which provides a cleaner API.
 *
 * @throws Error if used outside of DIContainerProvider
 */
export function useContainer(): AwilixContainer<CliCradle> {
  const container = useContext(DIContainerContext);
  if (!container) {
    throw new Error("useContainer must be used within DIContainerProvider");
  }
  return container;
}

/**
 * Hook to access a specific dependency from the container.
 *
 * This is the primary way to access dependencies in React components.
 * Dependencies are resolved lazily when accessed.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const projectsResolver = useDeps('projectsResolver');
 *   const fileSystem = useDeps('fileSystem');
 *   // ...
 * }
 * ```
 *
 * @param key - The name of the dependency to resolve
 * @returns The resolved dependency instance
 */
export function useDeps<T extends keyof CliCradle>(key: T): CliCradle[T] {
  const container = useContainer();
  return container.cradle[key];
}
