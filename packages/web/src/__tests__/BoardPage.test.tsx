import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BoardPage from "../app/page";

// Mock next/navigation
const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  usePathname: () => "/",
  useSearchParams: () => mockSearchParams,
}));

// Mock ProjectContext
vi.mock("../contexts", () => ({
  useProjectContext: () => ({
    projectId: "",
    isLoading: false,
    projects: [],
    setProjectId: vi.fn(),
  }),
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

// Mock hooks - must be after localStorageMock declaration
vi.mock("../hooks", () => ({
  useTasks: () => ({
    data: {
      issuesWithTasks: [],
      completedTasks: [],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUrlState: () => {
    // Re-use the mock localStorage state for useUrlState
    const stored = localStorageMock.getItem(URL_STATE_KEY);
    const state = stored ? JSON.parse(stored) : {};
    return {
      state,
      setState: (newState: Record<string, unknown>) => {
        if (Object.keys(newState).length > 0) {
          localStorageMock.setItem(URL_STATE_KEY, JSON.stringify(newState));
        } else {
          localStorageMock.removeItem(URL_STATE_KEY);
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
        const stored = localStorageMock.getItem(URL_STATE_KEY);
        const currentState = stored ? JSON.parse(stored) : {};
        const newState = { ...currentState, [key]: value };
        if (value === undefined) {
          delete newState[key];
        }
        if (Object.keys(newState).length > 0) {
          localStorageMock.setItem(URL_STATE_KEY, JSON.stringify(newState));
        } else {
          localStorageMock.removeItem(URL_STATE_KEY);
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

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("BoardPage showBacklog persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    mockSearchParams = new URLSearchParams();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("initializes showBacklog from localStorage", async () => {
    localStorageMock.getItem.mockImplementation((key: string) => {
      if (key === URL_STATE_KEY) {
        return JSON.stringify({ showBacklog: true });
      }
      return null;
    });

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <BoardPage />
      </Wrapper>
    );

    await waitFor(() => {
      const checkbox = screen.getByRole("checkbox", { name: /show backlog/i });
      expect(checkbox).toBeChecked();
    });
  });

  it("initializes showBacklog as false when localStorage is empty", async () => {
    localStorageMock.getItem.mockReturnValue(null);

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <BoardPage />
      </Wrapper>
    );

    await waitFor(() => {
      const checkbox = screen.getByRole("checkbox", { name: /show backlog/i });
      expect(checkbox).not.toBeChecked();
    });
  });

  it("persists showBacklog to localStorage when toggled on", async () => {
    localStorageMock.getItem.mockReturnValue(null);

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <BoardPage />
      </Wrapper>
    );

    await waitFor(() => {
      const checkbox = screen.getByRole("checkbox", { name: /show backlog/i });
      fireEvent.click(checkbox);
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      URL_STATE_KEY,
      JSON.stringify({ showBacklog: true })
    );
  });

  it("removes from localStorage when showBacklog is toggled off", async () => {
    localStorageMock.getItem.mockImplementation((key: string) => {
      if (key === URL_STATE_KEY) {
        return JSON.stringify({ showBacklog: true });
      }
      return null;
    });

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <BoardPage />
      </Wrapper>
    );

    await waitFor(() => {
      const checkbox = screen.getByRole("checkbox", { name: /show backlog/i });
      expect(checkbox).toBeChecked();
      fireEvent.click(checkbox);
    });

    expect(localStorageMock.removeItem).toHaveBeenCalledWith(URL_STATE_KEY);
  });

  it("updates URL with _state param when showBacklog changes", async () => {
    localStorageMock.getItem.mockReturnValue(null);

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <BoardPage />
      </Wrapper>
    );

    await waitFor(() => {
      const checkbox = screen.getByRole("checkbox", { name: /show backlog/i });
      fireEvent.click(checkbox);
    });

    // Should be called with base64 encoded _state param
    expect(mockPush).toHaveBeenCalled();
    const calledWith = mockPush.mock.calls[0]?.[0] as string | undefined;
    expect(calledWith).toBeDefined();
    expect(calledWith).toContain("_state=");
  });

  it("removes _state param from URL when toggled off", async () => {
    localStorageMock.getItem.mockImplementation((key: string) => {
      if (key === URL_STATE_KEY) {
        return JSON.stringify({ showBacklog: true });
      }
      return null;
    });

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <BoardPage />
      </Wrapper>
    );

    await waitFor(() => {
      const checkbox = screen.getByRole("checkbox", { name: /show backlog/i });
      expect(checkbox).toBeChecked();
      fireEvent.click(checkbox);
    });

    expect(mockPush).toHaveBeenCalledWith("/?");
  });
});
