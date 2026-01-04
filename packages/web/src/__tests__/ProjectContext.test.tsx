import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectProvider, useProjectContext } from "../contexts/ProjectContext";

// Mock next/navigation
const mockPush = vi.fn();
const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
  usePathname: () => "/",
  useSearchParams: () => mockSearchParams,
}));

// Mock useProjects hook
const mockProjects = [
  { id: "proj-1", name: "Project 1", trackDirectory: "/path/1", gitRoot: "/git/1" },
  { id: "proj-2", name: "Project 2", trackDirectory: "/path/2", gitRoot: "/git/2" },
];

vi.mock("../hooks", () => ({
  useProjects: () => ({
    data: mockProjects,
    isLoading: false,
  }),
  useUrlState: () => {
    // Re-use the mock localStorage state for useUrlState
    const stored = localStorageMock.getItem("dev-workflow-url-state");
    const state = stored ? JSON.parse(stored) : {};
    return {
      state,
      setState: (newState: Record<string, unknown>) => {
        if (Object.keys(newState).length > 0) {
          localStorageMock.setItem("dev-workflow-url-state", JSON.stringify(newState));
        } else {
          localStorageMock.removeItem("dev-workflow-url-state");
        }
        // Build _state param
        const encoded =
          Object.keys(newState).length > 0
            ? btoa(JSON.stringify(newState))
                .replace(/\+/g, "-")
                .replace(/\//g, "_")
                .replace(/=+$/, "")
            : null;
        const params = new URLSearchParams();
        if (encoded) {
          params.set("_state", encoded);
        }
        mockPush(`/?${params.toString()}`);
      },
      setProperty: (key: string, value: unknown) => {
        const stored = localStorageMock.getItem("dev-workflow-url-state");
        const currentState = stored ? JSON.parse(stored) : {};
        const newState = { ...currentState, [key]: value };
        if (value === undefined) {
          delete newState[key];
        }
        if (Object.keys(newState).length > 0) {
          localStorageMock.setItem("dev-workflow-url-state", JSON.stringify(newState));
        } else {
          localStorageMock.removeItem("dev-workflow-url-state");
        }
        // Build _state param
        const encoded =
          Object.keys(newState).length > 0
            ? btoa(JSON.stringify(newState))
                .replace(/\+/g, "-")
                .replace(/\//g, "_")
                .replace(/=+$/, "")
            : null;
        const params = new URLSearchParams();
        if (encoded) {
          params.set("_state", encoded);
        }
        mockPush(`/?${params.toString()}`);
      },
    };
  },
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

const URL_STATE_KEY = "dev-workflow-url-state";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ProjectProvider>{children}</ProjectProvider>
      </QueryClientProvider>
    );
  };
}

describe("ProjectContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    mockSearchParams = new URLSearchParams();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("provides projects from useProjects hook", () => {
    const { result } = renderHook(() => useProjectContext(), {
      wrapper: createWrapper(),
    });

    expect(result.current.projects).toEqual(mockProjects);
    expect(result.current.isLoading).toBe(false);
  });

  it("initializes projectId from localStorage", () => {
    // Set up localStorage with URL state
    localStorageMock.getItem.mockImplementation((key: string) => {
      if (key === URL_STATE_KEY) {
        return JSON.stringify({ project: "proj-1" });
      }
      return null;
    });

    const { result } = renderHook(() => useProjectContext(), {
      wrapper: createWrapper(),
    });

    expect(result.current.projectId).toBe("proj-1");
  });

  it("initializes projectId as empty when localStorage is empty", () => {
    localStorageMock.getItem.mockReturnValue(null);

    const { result } = renderHook(() => useProjectContext(), {
      wrapper: createWrapper(),
    });

    expect(result.current.projectId).toBe("");
  });

  it("persists projectId to localStorage when set", () => {
    const { result } = renderHook(() => useProjectContext(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setProjectId("proj-1");
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      URL_STATE_KEY,
      JSON.stringify({ project: "proj-1" })
    );
  });

  it("removes from localStorage when projectId is cleared", () => {
    localStorageMock.getItem.mockImplementation((key: string) => {
      if (key === URL_STATE_KEY) {
        return JSON.stringify({ project: "proj-1" });
      }
      return null;
    });

    const { result } = renderHook(() => useProjectContext(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setProjectId("");
    });

    expect(localStorageMock.removeItem).toHaveBeenCalledWith(URL_STATE_KEY);
  });

  it("updates URL with _state param when projectId changes", () => {
    const { result } = renderHook(() => useProjectContext(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setProjectId("proj-1");
    });

    // Should be called with base64 encoded _state param
    expect(mockPush).toHaveBeenCalled();
    const calledWith = mockPush.mock.calls[0]?.[0] as string | undefined;
    expect(calledWith).toBeDefined();
    expect(calledWith).toContain("_state=");
  });

  it("removes _state param from URL when projectId is cleared", () => {
    localStorageMock.getItem.mockImplementation((key: string) => {
      if (key === URL_STATE_KEY) {
        return JSON.stringify({ project: "proj-1" });
      }
      return null;
    });

    const { result } = renderHook(() => useProjectContext(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setProjectId("");
    });

    expect(mockPush).toHaveBeenCalledWith("/?");
  });

  it("throws error when used outside provider", () => {
    expect(() => {
      renderHook(() => useProjectContext());
    }).toThrow("useProjectContext must be used within a ProjectProvider");
  });
});
