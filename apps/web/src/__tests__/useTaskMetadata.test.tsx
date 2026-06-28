import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock the API client so we can control each metadata request independently.
vi.mock("@/lib/api", () => ({
  getTaskStatusHistory: vi.fn(),
  getTaskExecutionLogs: vi.fn(),
  getTaskDependencies: vi.fn(),
}));

import { getTaskStatusHistory, getTaskExecutionLogs, getTaskDependencies } from "@/lib/api";
import { useTaskMetadata } from "@/hooks/useTaskMetadata";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useTaskMetadata", () => {
  beforeEach(() => {
    vi.mocked(getTaskStatusHistory).mockReset();
    vi.mocked(getTaskExecutionLogs).mockReset();
    vi.mocked(getTaskDependencies).mockReset();
  });

  it("surfaces an error (not a spinner) when one query fails while another is still loading", async () => {
    // Logs fails (the real bug: /logs 404'd). Crucially, history never resolves —
    // so without the `!error` guard, the combined isLoading stays true forever and
    // error is masked → the tab hangs on "Loading metadata…". This test FAILS against
    // the pre-fix hook (where isLoading does not yield to error) and passes after it.
    vi.mocked(getTaskStatusHistory).mockReturnValue(new Promise(() => {}));
    vi.mocked(getTaskDependencies).mockResolvedValue([]);
    vi.mocked(getTaskExecutionLogs).mockRejectedValue(new Error("404 Not Found"));

    const { result } = renderHook(() => useTaskMetadata("proj", "task-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    // error must dominate the still-pending history query → no infinite spinner.
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("returns combined data when all queries succeed", async () => {
    vi.mocked(getTaskStatusHistory).mockResolvedValue([]);
    vi.mocked(getTaskDependencies).mockResolvedValue([]);
    vi.mocked(getTaskExecutionLogs).mockResolvedValue([]);

    const { result } = renderHook(() => useTaskMetadata("proj", "task-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.error).toBeFalsy();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual({ history: [], logs: [], dependencies: [] });
  });
});
