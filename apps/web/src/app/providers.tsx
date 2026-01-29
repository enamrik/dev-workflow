"use client";

import { Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { ProjectProvider } from "@/contexts";

function WebSocketProvider({ children }: { children: React.ReactNode }) {
  useWebSocket();
  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 2 * 1000, // 2 seconds
            refetchInterval: 2 * 1000, // Poll every 2 seconds (pauses when tab hidden)
            refetchOnWindowFocus: true, // Immediate refresh when user returns
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <WebSocketProvider>
        <Suspense fallback={null}>
          <ProjectProvider>{children}</ProjectProvider>
        </Suspense>
      </WebSocketProvider>
    </QueryClientProvider>
  );
}
