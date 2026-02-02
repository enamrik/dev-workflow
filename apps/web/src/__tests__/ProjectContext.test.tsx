import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { ProjectProvider, useProjectContext } from "../contexts/ProjectContext";
import { createTestWrapper } from "@/__tests__/test-utils";

const mockPush = vi.fn();

const mockProjects = [
  {
    id: "proj-1",
    name: "Project 1",
    slug: "project-1",
    trackDirectory: "/path/1",
    gitRoot: "/git/1",
  },
  {
    id: "proj-2",
    name: "Project 2",
    slug: "project-2",
    trackDirectory: "/path/2",
    gitRoot: "/git/2",
  },
];

// Mock localStorage with a real backing store and spy tracking
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
    /** Pre-populate the backing store (without triggering spy tracking). */
    _seed(key: string, value: string) {
      store[key] = value;
    },
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

const URL_STATE_KEY = "dev-workflow-url-state";

function createWrapper() {
  const Outer = createTestWrapper({
    router: { push: mockPush },
    pathname: "/",
    queryData: [{ queryKey: ["projects"], data: { projects: mockProjects } }],
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <Outer>
        <ProjectProvider>{children}</ProjectProvider>
      </Outer>
    );
  };
}

describe("ProjectContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  it("provides allProjects from useProjects hook", async () => {
    const { result } = renderHook(() => useProjectContext(), {
      wrapper: createWrapper(),
    });

    // All projects should be available
    await waitFor(() => {
      expect(result.current.allProjects).toEqual(mockProjects);
    });
    expect(result.current.isLoading).toBe(false);
  });

  it("initializes projectId from localStorage", () => {
    // Pre-populate localStorage before render
    localStorageMock._seed(URL_STATE_KEY, JSON.stringify({ project: "proj-1" }));

    const { result } = renderHook(() => useProjectContext(), {
      wrapper: createWrapper(),
    });

    expect(result.current.projectId).toBe("proj-1");
  });

  it("initializes projectId as empty when localStorage is empty", () => {
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
    // Pre-populate localStorage before render
    localStorageMock._seed(URL_STATE_KEY, JSON.stringify({ project: "proj-1" }));

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
    // Pre-populate localStorage before render
    localStorageMock._seed(URL_STATE_KEY, JSON.stringify({ project: "proj-1" }));

    const { result } = renderHook(() => useProjectContext(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setProjectId("");
    });

    expect(mockPush).toHaveBeenCalledWith("/");
  });

  it("throws error when used outside provider", () => {
    expect(() => {
      renderHook(() => useProjectContext());
    }).toThrow("useProjectContext must be used within a ProjectProvider");
  });
});
