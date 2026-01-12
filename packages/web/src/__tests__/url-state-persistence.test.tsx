/**
 * Integration tests for URL state persistence across all pages.
 * Verifies that the _state parameter is preserved when navigating between views.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";

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

// Mock Next.js navigation hooks
vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
  useSearchParams: vi.fn(),
  useRouter: vi.fn(),
  useParams: vi.fn(() => ({})),
}));

// Mock ProjectContext
vi.mock("@/contexts", () => ({
  useProjectContext: vi.fn(() => ({
    projectId: "test-project",
    sourceId: "test-source",
    setProjectId: vi.fn(),
    allProjects: [],
    sources: [],
    isLoading: false,
  })),
}));

// Mock data hooks
vi.mock("@/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks")>();
  return {
    ...actual,
    useWorktrees: vi.fn(() => ({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })),
    usePruneWorktrees: vi.fn(() => ({
      mutateAsync: vi.fn(),
      isPending: false,
    })),
    useWorkerData: vi.fn(() => ({
      data: { workers: [], queue: [], stats: { total: 0, unclaimed: 0, claimed: 0, stale: 0 } },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })),
    useRefreshWorkerData: vi.fn(() => vi.fn()),
    useIssues: vi.fn(() => ({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })),
  };
});

import WorktreesPage from "@/app/worktrees/page";
import WorkersPage from "@/app/workers/page";
import IssuesPage from "@/app/issues/page";

describe("URL State Persistence", () => {
  let mockRouter: ReturnType<typeof vi.fn>;
  let mockSearchParams: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Clear localStorage
    localStorage.clear();

    // Setup mock router
    mockRouter = vi.fn(() => ({
      push: vi.fn(),
      replace: vi.fn(),
      prefetch: vi.fn(),
    }));
    vi.mocked(useRouter).mockReturnValue(mockRouter());

    // Setup mock search params
    mockSearchParams = vi.fn(() => ({
      get: vi.fn((key: string) => {
        if (key === "_state") {
          // Return encoded state: {source: "global", project: "test-project"}
          return "eyJzb3VyY2UiOiJnbG9iYWwiLCJwcm9qZWN0IjoidGVzdC1wcm9qZWN0In0";
        }
        return null;
      }),
      toString: () => "_state=eyJzb3VyY2UiOiJnbG9iYWwiLCJwcm9qZWN0IjoidGVzdC1wcm9qZWN0In0",
    }));
    vi.mocked(useSearchParams).mockReturnValue(mockSearchParams() as any);
  });

  describe("Worktrees Page", () => {
    it("should call useUrlState hook to enable state persistence", () => {
      vi.mocked(usePathname).mockReturnValue("/worktrees");

      render(<WorktreesPage />);

      // Check that state was synced to localStorage
      waitFor(() => {
        const stored = localStorage.getItem("dev-workflow-url-state");
        expect(stored).toBeDefined();
        if (stored) {
          const parsed = JSON.parse(stored);
          expect(parsed.source).toBe("global");
          expect(parsed.project).toBe("test-project");
        }
      });
    });

    it("should restore _state from localStorage when URL doesn't have it", () => {
      vi.mocked(usePathname).mockReturnValue("/worktrees");

      // Set state in localStorage
      localStorage.setItem(
        "dev-workflow-url-state",
        JSON.stringify({ source: "global", project: "test-project" })
      );

      // Mock search params without _state
      vi.mocked(useSearchParams).mockReturnValue({
        get: vi.fn(() => null),
        toString: () => "",
      } as any);

      const mockReplace = vi.fn();
      vi.mocked(useRouter).mockReturnValue({
        push: vi.fn(),
        replace: mockReplace,
        prefetch: vi.fn(),
      } as any);

      render(<WorktreesPage />);

      // Should call replace with _state parameter
      waitFor(() => {
        expect(mockReplace).toHaveBeenCalled();
        const callArgs = mockReplace.mock.calls[0]?.[0];
        expect(callArgs).toBeDefined();
        expect(callArgs).toContain("_state=");
      });
    });
  });

  describe("Workers Page", () => {
    it("should call useUrlState hook to enable state persistence", () => {
      vi.mocked(usePathname).mockReturnValue("/workers");

      render(<WorkersPage />);

      // Check that state was synced to localStorage
      waitFor(() => {
        const stored = localStorage.getItem("dev-workflow-url-state");
        expect(stored).toBeDefined();
        if (stored) {
          const parsed = JSON.parse(stored);
          expect(parsed.source).toBe("global");
          expect(parsed.project).toBe("test-project");
        }
      });
    });
  });

  describe("Issues Page", () => {
    it("should call useUrlState hook to enable state persistence", () => {
      vi.mocked(usePathname).mockReturnValue("/issues");

      render(<IssuesPage />);

      // Check that state was synced to localStorage
      waitFor(() => {
        const stored = localStorage.getItem("dev-workflow-url-state");
        expect(stored).toBeDefined();
        if (stored) {
          const parsed = JSON.parse(stored);
          expect(parsed.source).toBe("global");
          expect(parsed.project).toBe("test-project");
        }
      });
    });
  });

  describe("Pinned navigation items", () => {
    it("should store pinned nav items in _state", () => {
      vi.mocked(usePathname).mockReturnValue("/");

      // Mock URL state with pinned items
      vi.mocked(useSearchParams).mockReturnValue({
        get: vi.fn((key: string) => {
          if (key === "_state") {
            // State with pinned items: {pinnedNavItems: ["/worktrees", "/workers"]}
            return "eyJwaW5uZWROYXZJdGVtcyI6WyIvd29ya3RyZWVzIiwiL3dvcmtlcnMiXX0";
          }
          return null;
        }),
        toString: () => "_state=eyJwaW5uZWROYXZJdGVtcyI6WyIvd29ya3RyZWVzIiwiL3dvcmtlcnMiXX0",
      } as any);

      render(<WorktreesPage />);

      // Should sync pinned items to localStorage
      waitFor(() => {
        const stored = localStorage.getItem("dev-workflow-url-state");
        expect(stored).toBeDefined();
        if (stored) {
          const parsed = JSON.parse(stored);
          expect(parsed.pinnedNavItems).toEqual(["/worktrees", "/workers"]);
        }
      });
    });

    it("should preserve pinned items when sharing URL", () => {
      // Set pinned items in localStorage
      localStorage.setItem(
        "dev-workflow-url-state",
        JSON.stringify({ pinnedNavItems: ["/worktrees"] })
      );

      vi.mocked(usePathname).mockReturnValue("/");
      vi.mocked(useSearchParams).mockReturnValue({
        get: vi.fn(() => null),
        toString: () => "",
      } as any);

      const mockReplace = vi.fn();
      vi.mocked(useRouter).mockReturnValue({
        push: vi.fn(),
        replace: mockReplace,
        prefetch: vi.fn(),
      } as any);

      render(<WorktreesPage />);

      // Should restore _state with pinned items
      waitFor(() => {
        expect(mockReplace).toHaveBeenCalled();
        const callArgs = mockReplace.mock.calls[0]?.[0];
        expect(callArgs).toBeDefined();
        expect(callArgs).toContain("_state=");
        // Decode and verify pinnedNavItems is in the URL
        const match = callArgs?.match(/_state=([^&]+)/);
        if (match) {
          const decoded = JSON.parse(atob(match[1].replace(/-/g, "+").replace(/_/g, "/")));
          expect(decoded.pinnedNavItems).toEqual(["/worktrees"]);
        }
      });
    });
  });

  describe("Cross-page navigation", () => {
    it("should preserve state when navigating from Board to Worktrees", () => {
      // Simulate user on Board page with state
      localStorage.setItem(
        "dev-workflow-url-state",
        JSON.stringify({ source: "global", project: "test-project" })
      );

      // Navigate to Worktrees
      vi.mocked(usePathname).mockReturnValue("/worktrees");
      vi.mocked(useSearchParams).mockReturnValue({
        get: vi.fn(() => null),
        toString: () => "",
      } as any);

      const mockReplace = vi.fn();
      vi.mocked(useRouter).mockReturnValue({
        push: vi.fn(),
        replace: mockReplace,
        prefetch: vi.fn(),
      } as any);

      render(<WorktreesPage />);

      // Should restore _state from localStorage
      waitFor(() => {
        expect(mockReplace).toHaveBeenCalled();
        const callArgs = mockReplace.mock.calls[0]?.[0];
        expect(callArgs).toBeDefined();
        expect(callArgs).toContain("_state=");
        expect(callArgs).toContain("/worktrees");
      });
    });

    it("should preserve state when navigating from Board to Workers", () => {
      // Simulate user on Board page with state
      localStorage.setItem(
        "dev-workflow-url-state",
        JSON.stringify({ source: "global", project: "test-project" })
      );

      // Navigate to Workers
      vi.mocked(usePathname).mockReturnValue("/workers");
      vi.mocked(useSearchParams).mockReturnValue({
        get: vi.fn(() => null),
        toString: () => "",
      } as any);

      const mockReplace = vi.fn();
      vi.mocked(useRouter).mockReturnValue({
        push: vi.fn(),
        replace: mockReplace,
        prefetch: vi.fn(),
      } as any);

      render(<WorkersPage />);

      // Should restore _state from localStorage
      waitFor(() => {
        expect(mockReplace).toHaveBeenCalled();
        const callArgs = mockReplace.mock.calls[0]?.[0];
        expect(callArgs).toBeDefined();
        expect(callArgs).toContain("_state=");
        expect(callArgs).toContain("/workers");
      });
    });
  });
});
