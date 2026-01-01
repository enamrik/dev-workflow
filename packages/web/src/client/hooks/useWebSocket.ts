import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
const PING_INTERVAL = 30000;

interface WebSocketMessage {
  type: string;
  payload?: {
    type?: string;
    issueNumber?: number;
    taskId?: string;
    [key: string]: unknown;
  };
}

/**
 * WebSocket hook that automatically invalidates TanStack Query caches
 * when domain events are received from the server.
 */
export function useWebSocket() {
  const queryClient = useQueryClient();
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        console.log("[WS] Connected");
        reconnectAttemptsRef.current = 0;

        // Start ping interval
        pingIntervalRef.current = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "ping" }));
          }
        }, PING_INTERVAL);
      };

      socket.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          handleMessage(message);
        } catch (error) {
          console.error("[WS] Failed to parse message:", error);
        }
      };

      socket.onclose = () => {
        console.log("[WS] Disconnected");
        cleanup();
        scheduleReconnect();
      };

      socket.onerror = (error) => {
        console.error("[WS] Error:", error);
      };
    }

    function cleanup() {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
    }

    function scheduleReconnect() {
      const delay = Math.min(
        RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttemptsRef.current),
        RECONNECT_MAX_DELAY
      );
      reconnectAttemptsRef.current++;

      console.log(
        `[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`
      );

      setTimeout(() => {
        if (
          !socketRef.current ||
          socketRef.current.readyState === WebSocket.CLOSED
        ) {
          connect();
        }
      }, delay);
    }

    function handleMessage(message: WebSocketMessage) {
      if (message.type === "connected") {
        console.log("[WS] Server says:", message.payload);
        return;
      }

      if (message.type === "pong") {
        return;
      }

      if (message.type === "event" && message.payload) {
        handleDomainEvent(message.payload);
      }
    }

    function handleDomainEvent(event: NonNullable<WebSocketMessage["payload"]>) {
      const eventType = event.type;
      console.log("[WS] Event:", eventType);

      if (!eventType) return;

      // Handle cross-process database change detection
      // This is a catch-all that invalidates all caches when another process
      // (like MCP tools) modifies the database
      if (eventType === "db:changed") {
        console.log("[WS] Database changed by another process, refreshing...");
        queryClient.invalidateQueries({ queryKey: ["issues"] });
        queryClient.invalidateQueries({ queryKey: ["issue"] });
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        queryClient.invalidateQueries({ queryKey: ["milestones"] });
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        return;
      }

      // Invalidate relevant query caches based on event type
      if (eventType.startsWith("issue:")) {
        queryClient.invalidateQueries({ queryKey: ["issues"] });
        queryClient.invalidateQueries({ queryKey: ["issue"] });
      }

      if (eventType.startsWith("task:")) {
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        queryClient.invalidateQueries({ queryKey: ["issue"] }); // Task counts in issue detail
        queryClient.invalidateQueries({ queryKey: ["issues"] }); // Task progress in list
      }

      if (eventType.startsWith("plan:")) {
        queryClient.invalidateQueries({ queryKey: ["issue"] });
        queryClient.invalidateQueries({ queryKey: ["issues"] });
      }

      if (eventType.startsWith("milestone:")) {
        queryClient.invalidateQueries({ queryKey: ["milestones"] });
      }

      if (eventType.startsWith("snapshot:")) {
        queryClient.invalidateQueries({ queryKey: ["issue"] });
        queryClient.invalidateQueries({ queryKey: ["issues"] });
      }
    }

    // Connect on mount
    connect();

    // Cleanup on unmount
    return () => {
      cleanup();
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [queryClient]);
}
