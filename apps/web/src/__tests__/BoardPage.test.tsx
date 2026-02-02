import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createTestWrapper } from "./test-utils";
import { ProjectProvider } from "@/contexts/ProjectContext";
import type { AppRouter } from "@/contexts/NavigationContext";
import BoardPage from "../app/page";

const mockPush = vi.fn();

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

function createWrapper(options?: { searchParams?: URLSearchParams }) {
  const Outer = createTestWrapper({
    router: { push: mockPush } as Partial<AppRouter>,
    pathname: "/",
    searchParams: options?.searchParams,
    queryData: [
      { queryKey: ["projects"], data: { projects: [] } },
      {
        queryKey: ["tasks", { project: undefined }],
        data: { issuesWithTasks: [], completedTasks: [] },
      },
      {
        queryKey: ["workerData"],
        data: {
          workers: [],
          queue: [],
          stats: { total: 0, unclaimed: 0, claimed: 0, stale: 0 },
        },
      },
    ],
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <Outer>
        <ProjectProvider>{children}</ProjectProvider>
      </Outer>
    );
  };
}

// Helper to open the settings dropdown and click a toggle
async function clickSettingsToggle(toggleName: RegExp) {
  // Find and click the settings button (gear icon)
  const settingsButtons = screen.getAllByRole("button");
  const settingsButton = settingsButtons.find((btn) => btn.querySelector("svg"));
  expect(settingsButton).toBeDefined();
  fireEvent.click(settingsButton!);

  // Find and click the toggle button
  await waitFor(() => {
    const toggleButton = screen.getByRole("button", { name: toggleName });
    fireEvent.click(toggleButton);
  });
}

describe("BoardPage showBacklog persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the board page with settings dropdown", async () => {
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <BoardPage />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText("Task Board")).toBeInTheDocument();
      // Stats ribbon shows "Tasks" label with "X active" badge
      expect(screen.getByText("Tasks")).toBeInTheDocument();
    });
  });

  it("persists showBacklog to localStorage when toggled on via dropdown", async () => {
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <BoardPage />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText("Task Board")).toBeInTheDocument();
    });

    await clickSettingsToggle(/show backlog/i);

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      URL_STATE_KEY,
      JSON.stringify({ showBacklog: true })
    );
  });

  it("removes from localStorage when showBacklog is toggled off", async () => {
    // Pre-set localStorage with showBacklog: true
    localStorageMock.setItem(URL_STATE_KEY, JSON.stringify({ showBacklog: true }));
    // Clear the mock call history so we only see the new calls
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();

    // Provide _state in searchParams so useUrlState reads it from URL
    const stateObj = { showBacklog: true };
    const encoded = btoa(JSON.stringify(stateObj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const searchParams = new URLSearchParams();
    searchParams.set("_state", encoded);

    const Wrapper = createWrapper({ searchParams });
    render(
      <Wrapper>
        <BoardPage />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText("Task Board")).toBeInTheDocument();
    });

    await clickSettingsToggle(/show backlog/i);

    expect(localStorageMock.removeItem).toHaveBeenCalledWith(URL_STATE_KEY);
  });

  it("updates URL with _state param when showBacklog changes", async () => {
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <BoardPage />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText("Task Board")).toBeInTheDocument();
    });

    await clickSettingsToggle(/show backlog/i);

    // Should be called with base64 encoded _state param
    expect(mockPush).toHaveBeenCalled();
    const calledWith = mockPush.mock.calls[0]?.[0] as string | undefined;
    expect(calledWith).toBeDefined();
    expect(calledWith).toContain("_state=");
  });

  it("removes _state param from URL when toggled off", async () => {
    // Pre-set localStorage with showBacklog: true
    localStorageMock.setItem(URL_STATE_KEY, JSON.stringify({ showBacklog: true }));
    localStorageMock.setItem.mockClear();

    // Provide _state in searchParams so useUrlState reads it from URL
    const stateObj = { showBacklog: true };
    const encoded = btoa(JSON.stringify(stateObj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const searchParams = new URLSearchParams();
    searchParams.set("_state", encoded);

    const Wrapper = createWrapper({ searchParams });
    render(
      <Wrapper>
        <BoardPage />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText("Task Board")).toBeInTheDocument();
    });

    await clickSettingsToggle(/show backlog/i);

    // When state is empty, push is called without _state
    expect(mockPush).toHaveBeenCalled();
    const calledWith = mockPush.mock.calls[0]?.[0] as string | undefined;
    expect(calledWith).toBeDefined();
    expect(calledWith).not.toContain("_state=");
  });

  it("can toggle showWorkQueue via dropdown", async () => {
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <BoardPage />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText("Task Board")).toBeInTheDocument();
    });

    await clickSettingsToggle(/show work queue/i);

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      URL_STATE_KEY,
      JSON.stringify({ showWorkQueue: true })
    );
  });
});
