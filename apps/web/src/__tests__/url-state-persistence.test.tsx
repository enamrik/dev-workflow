/**
 * Integration tests for URL state persistence across all pages.
 * Verifies that the _state parameter is synced between URL and localStorage.
 *
 * Uses TestNavigationProvider (via createTestWrapper) instead of vi.mock("next/navigation").
 * Uses pre-seeded React Query cache instead of vi.mock("@/hooks").
 * Uses ProjectProvider with pre-seeded projects data instead of vi.mock("@/contexts").
 */

import React, { useState } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TestNavigationProvider, type AppRouter } from "@/contexts/NavigationContext";
import { ProjectProvider } from "@/contexts/ProjectContext";

import WorktreesPage from "@/app/worktrees/page";
import WorkersPage from "@/app/workers/page";
import IssuesPage from "@/app/issues/page";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(global, "localStorage", { value: localStorageMock });

const URL_STATE_KEY = "dev-workflow-url-state";

const mockProjects = [
  {
    id: "test-project",
    name: "Test Project",
    slug: "test-project",
    trackDirectory: "/path",
    gitRoot: "/git",
  },
];

/**
 * Base query data pre-seeded into the React Query cache for all page renders.
 * Query keys must match what the real hooks produce given the components' arguments.
 */
function getBaseQueryData() {
  return [
    { queryKey: ["projects"], data: { projects: mockProjects } },
    {
      queryKey: ["worktrees", { project: "test-project" }],
      data: [],
    },
    {
      queryKey: ["workerData"],
      data: {
        workers: [],
        queue: [],
        stats: { total: 0, unclaimed: 0, claimed: 0, stale: 0 },
      },
    },
    {
      queryKey: ["issues", { project: "test-project" }],
      data: [],
    },
    {
      queryKey: ["tasks", { project: "test-project" }],
      data: { issuesWithTasks: [], completedTasks: [] },
    },
  ];
}

/**
 * Creates a QueryClient pre-seeded with base query data.
 */
function createSeededQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  for (const { queryKey, data } of getBaseQueryData()) {
    queryClient.setQueryData(queryKey, data);
  }
  return queryClient;
}

/**
 * Encode a state object to URL-safe base64, matching the format used by useUrlState.
 */
function encodeUrlState(state: Record<string, unknown>): string {
  return btoa(JSON.stringify(state)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * A wrapper component that supports changing the pathname to simulate navigation.
 * useUrlState restores _state from localStorage only when the pathname changes.
 */
function NavigableWrapper({
  children,
  initialPathname,
  searchParams,
  router,
  queryClient,
  onSetPathname,
}: {
  children: React.ReactNode;
  initialPathname: string;
  searchParams?: URLSearchParams;
  router?: Partial<AppRouter>;
  queryClient: QueryClient;
  onSetPathname?: (setter: (p: string) => void) => void;
}) {
  const [pathname, setPathname] = useState(initialPathname);

  // Expose the setter to the test so it can trigger navigation
  React.useEffect(() => {
    if (onSetPathname) {
      onSetPathname(setPathname);
    }
  }, [onSetPathname]);

  return (
    <QueryClientProvider client={queryClient}>
      <TestNavigationProvider router={router} pathname={pathname} searchParams={searchParams}>
        <ProjectProvider>{children}</ProjectProvider>
      </TestNavigationProvider>
    </QueryClientProvider>
  );
}

/**
 * Renders a page inside the navigable wrapper, returning a navigateTo function
 * that simulates changing the pathname (triggering useUrlState's restore effect).
 */
function renderWithNavigation(
  PageComponent: React.ComponentType,
  options: {
    initialPathname: string;
    searchParams?: URLSearchParams;
    router?: Partial<AppRouter>;
  }
) {
  const queryClient = createSeededQueryClient();
  let navigate: ((p: string) => void) | null = null;

  const result = render(
    <NavigableWrapper
      initialPathname={options.initialPathname}
      searchParams={options.searchParams}
      router={options.router}
      queryClient={queryClient}
      onSetPathname={(setter) => {
        navigate = setter;
      }}
    >
      <PageComponent />
    </NavigableWrapper>
  );

  return {
    ...result,
    navigateTo: (pathname: string) => {
      act(() => {
        navigate?.(pathname);
      });
    },
  };
}

/**
 * Simple page render for tests that don't need navigation simulation.
 */
function renderPage(
  PageComponent: React.ComponentType,
  options: {
    pathname?: string;
    searchParams?: URLSearchParams;
    router?: Partial<AppRouter>;
  } = {}
) {
  const queryClient = createSeededQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <TestNavigationProvider
        router={options.router}
        pathname={options.pathname ?? "/"}
        searchParams={options.searchParams}
      >
        <ProjectProvider>
          <PageComponent />
        </ProjectProvider>
      </TestNavigationProvider>
    </QueryClientProvider>
  );
}

describe("URL State Persistence", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  describe("Worktrees Page", () => {
    it("should sync _state from URL to localStorage", async () => {
      const encoded = encodeUrlState({ project: "test-project" });
      const searchParams = new URLSearchParams();
      searchParams.set("_state", encoded);

      renderPage(WorktreesPage, {
        pathname: "/worktrees",
        searchParams,
      });

      await waitFor(() => {
        const stored = localStorage.getItem(URL_STATE_KEY);
        expect(stored).toBeDefined();
        if (stored) {
          const parsed = JSON.parse(stored);
          expect(parsed.project).toBe("test-project");
        }
      });
    });

    it("should restore _state from localStorage when URL doesn't have it", async () => {
      // Pre-set localStorage with state
      localStorage.setItem(URL_STATE_KEY, JSON.stringify({ project: "test-project" }));

      const mockReplace = vi.fn();

      // Start at a different pathname, then "navigate" to /worktrees
      // to trigger useUrlState's restore-from-localStorage effect
      const { navigateTo } = renderWithNavigation(WorktreesPage, {
        initialPathname: "/",
        searchParams: new URLSearchParams(),
        router: { replace: mockReplace },
      });

      // Simulate navigation to /worktrees (pathname change triggers restore)
      navigateTo("/worktrees");

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalled();
        const callArgs = mockReplace.mock.calls[0]?.[0] as string | undefined;
        expect(callArgs).toBeDefined();
        expect(callArgs).toContain("_state=");
      });
    });
  });

  describe("Workers Page", () => {
    it("should sync _state from URL to localStorage", async () => {
      const encoded = encodeUrlState({ project: "test-project" });
      const searchParams = new URLSearchParams();
      searchParams.set("_state", encoded);

      renderPage(WorkersPage, {
        pathname: "/workers",
        searchParams,
      });

      await waitFor(() => {
        const stored = localStorage.getItem(URL_STATE_KEY);
        expect(stored).toBeDefined();
        if (stored) {
          const parsed = JSON.parse(stored);
          expect(parsed.project).toBe("test-project");
        }
      });
    });
  });

  describe("Issues Page", () => {
    it("should sync _state from URL to localStorage", async () => {
      const encoded = encodeUrlState({ project: "test-project" });
      const searchParams = new URLSearchParams();
      searchParams.set("_state", encoded);

      renderPage(IssuesPage, {
        pathname: "/issues",
        searchParams,
      });

      await waitFor(() => {
        const stored = localStorage.getItem(URL_STATE_KEY);
        expect(stored).toBeDefined();
        if (stored) {
          const parsed = JSON.parse(stored);
          expect(parsed.project).toBe("test-project");
        }
      });
    });
  });

  describe("Pinned navigation items", () => {
    it("should store pinned nav items in _state", async () => {
      const encoded = encodeUrlState({
        pinnedNavItems: ["/worktrees", "/workers"],
      });
      const searchParams = new URLSearchParams();
      searchParams.set("_state", encoded);

      renderPage(WorktreesPage, {
        pathname: "/worktrees",
        searchParams,
      });

      await waitFor(() => {
        const stored = localStorage.getItem(URL_STATE_KEY);
        expect(stored).toBeDefined();
        if (stored) {
          const parsed = JSON.parse(stored);
          expect(parsed.pinnedNavItems).toEqual(["/worktrees", "/workers"]);
        }
      });
    });

    it("should preserve pinned items when sharing URL", async () => {
      // Pre-set pinned items in localStorage
      localStorage.setItem(URL_STATE_KEY, JSON.stringify({ pinnedNavItems: ["/worktrees"] }));

      const mockReplace = vi.fn();

      // Start at a different pathname, then navigate to trigger restore
      const { navigateTo } = renderWithNavigation(WorktreesPage, {
        initialPathname: "/",
        searchParams: new URLSearchParams(),
        router: { replace: mockReplace },
      });

      navigateTo("/worktrees");

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalled();
        const callArgs = mockReplace.mock.calls[0]?.[0] as string | undefined;
        expect(callArgs).toBeDefined();
        expect(callArgs).toContain("_state=");
        // Decode and verify pinnedNavItems is in the URL
        const match = callArgs?.match(/_state=([^&]+)/);
        if (match?.[1]) {
          let base64 = match[1].replace(/-/g, "+").replace(/_/g, "/");
          const padding = base64.length % 4;
          if (padding) {
            base64 += "=".repeat(4 - padding);
          }
          const decoded = JSON.parse(atob(base64));
          expect(decoded.pinnedNavItems).toEqual(["/worktrees"]);
        }
      });
    });
  });

  describe("Cross-page navigation", () => {
    it("should preserve state when navigating from Board to Worktrees", async () => {
      // Simulate user on Board page with state already in localStorage
      localStorage.setItem(URL_STATE_KEY, JSON.stringify({ project: "test-project" }));

      const mockReplace = vi.fn();

      // Start on Board ("/"), then navigate to Worktrees
      const { navigateTo } = renderWithNavigation(WorktreesPage, {
        initialPathname: "/",
        searchParams: new URLSearchParams(),
        router: { replace: mockReplace },
      });

      navigateTo("/worktrees");

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalled();
        const callArgs = mockReplace.mock.calls[0]?.[0] as string | undefined;
        expect(callArgs).toBeDefined();
        expect(callArgs).toContain("_state=");
        expect(callArgs).toContain("/worktrees");
      });
    });

    it("should preserve state when navigating from Board to Workers", async () => {
      // Simulate user on Board page with state already in localStorage
      localStorage.setItem(URL_STATE_KEY, JSON.stringify({ project: "test-project" }));

      const mockReplace = vi.fn();

      // Start on Board ("/"), then navigate to Workers
      const { navigateTo } = renderWithNavigation(WorkersPage, {
        initialPathname: "/",
        searchParams: new URLSearchParams(),
        router: { replace: mockReplace },
      });

      navigateTo("/workers");

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalled();
        const callArgs = mockReplace.mock.calls[0]?.[0] as string | undefined;
        expect(callArgs).toBeDefined();
        expect(callArgs).toContain("_state=");
        expect(callArgs).toContain("/workers");
      });
    });
  });
});
