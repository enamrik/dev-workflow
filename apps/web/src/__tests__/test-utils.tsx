import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TestNavigationProvider, type AppRouter } from "@/contexts/NavigationContext";

interface TestWrapperOptions {
  router?: Partial<AppRouter>;
  pathname?: string;
  searchParams?: URLSearchParams;
  queryData?: Array<{ queryKey: unknown[]; data: unknown }>;
}

/**
 * Creates a test wrapper with injectable navigation and pre-seeded React Query cache.
 * Eliminates the need for vi.mock("next/navigation") and vi.mock("@/hooks").
 *
 * Usage:
 * ```tsx
 * const wrapper = createTestWrapper({
 *   router: { push: vi.fn() },
 *   pathname: "/",
 *   queryData: [
 *     { queryKey: ["projects"], data: { projects: [...] } },
 *     { queryKey: ["tasks", undefined], data: { issuesWithTasks: [], completedTasks: [] } },
 *   ],
 * });
 * render(<MyComponent />, { wrapper });
 * ```
 */
export function createTestWrapper(options: TestWrapperOptions = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  // Pre-seed React Query cache
  if (options.queryData) {
    for (const { queryKey, data } of options.queryData) {
      queryClient.setQueryData(queryKey, data);
    }
  }

  return function TestWrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <TestNavigationProvider
          router={options.router}
          pathname={options.pathname}
          searchParams={options.searchParams}
        >
          {children}
        </TestNavigationProvider>
      </QueryClientProvider>
    );
  };
}
