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

// Mock useTasks hook
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

const SHOW_BACKLOG_STORAGE_KEY = "dev-workflow-show-backlog";

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
      if (key === SHOW_BACKLOG_STORAGE_KEY) {
        return "true";
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

    expect(localStorageMock.setItem).toHaveBeenCalledWith(SHOW_BACKLOG_STORAGE_KEY, "true");
  });

  it("removes from localStorage when showBacklog is toggled off", async () => {
    localStorageMock.getItem.mockImplementation((key: string) => {
      if (key === SHOW_BACKLOG_STORAGE_KEY) {
        return "true";
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

    expect(localStorageMock.removeItem).toHaveBeenCalledWith(SHOW_BACKLOG_STORAGE_KEY);
  });

  it("updates URL when showBacklog changes", async () => {
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

    expect(mockPush).toHaveBeenCalledWith("/?showBacklog=true");
  });

  it("removes showBacklog param from URL when toggled off", async () => {
    mockSearchParams = new URLSearchParams("?showBacklog=true");
    localStorageMock.getItem.mockImplementation((key: string) => {
      if (key === SHOW_BACKLOG_STORAGE_KEY) {
        return "true";
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
