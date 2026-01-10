"use client";

import { useCallback, useMemo, useEffect, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

/**
 * URL state shape. Add new properties here as needed.
 */
export interface UrlState {
  /** Selected data source ID */
  source?: string;
  /** Selected project ID */
  project?: string;
  showBacklog?: boolean;
  showWorkQueue?: boolean;
  showCompleted?: boolean;
  /** Show stats ribbon (task/worker counts) - defaults to true */
  showStats?: boolean;
  /** Pinned navigation items (hrefs) */
  pinnedNavItems?: string[];
}

const STATE_PARAM = "_state";
const STORAGE_KEY = "dev-workflow-url-state";

/**
 * Encode state object to URL-safe base64 string.
 * Returns undefined if state is empty.
 */
function encodeState(state: UrlState): string | undefined {
  // Remove undefined values and check if empty
  const cleaned = Object.fromEntries(Object.entries(state).filter(([, v]) => v !== undefined));
  if (Object.keys(cleaned).length === 0) {
    return undefined;
  }
  const json = JSON.stringify(cleaned);
  // Use URL-safe base64 encoding
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode URL-safe base64 string to state object.
 * Returns empty object on decode failure.
 */
function decodeState(encoded: string): UrlState {
  try {
    // Restore standard base64 from URL-safe version
    let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    // Add padding if needed
    const padding = base64.length % 4;
    if (padding) {
      base64 += "=".repeat(4 - padding);
    }
    const json = atob(base64);
    return JSON.parse(json) as UrlState;
  } catch {
    return {};
  }
}

/**
 * Get state from localStorage.
 */
function getStoredState(): UrlState {
  if (typeof window === "undefined") {
    return {};
  }

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored) as UrlState;
    } catch {
      return {};
    }
  }

  return {};
}

/**
 * Hook for managing UI state in the URL via ?_state= parameter.
 *
 * The state is encoded as base64 JSON for URL safety and compactness.
 * localStorage is used as the source of truth, with URL for shareability.
 *
 * Usage:
 * ```tsx
 * const { state, setState, setProperty } = useUrlState();
 *
 * // Read state
 * const projectId = state.project;
 *
 * // Set entire state
 * setState({ project: "abc", showBacklog: true });
 *
 * // Set single property
 * setProperty("showBacklog", true);
 * ```
 */
export function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const prevPathnameRef = useRef(pathname);
  const isUserActionRef = useRef(false);

  // Parse current state from URL or localStorage
  const state = useMemo((): UrlState => {
    // On client, check both URL and localStorage
    if (typeof window !== "undefined") {
      const urlState = searchParams.get(STATE_PARAM);
      if (urlState) {
        const decoded = decodeState(urlState);
        // Sync to localStorage when URL has state (shared link scenario)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(decoded));
        return decoded;
      }

      // Fall back to localStorage
      return getStoredState();
    }
    return {};
  }, [searchParams]);

  // Restore _state to URL when navigating between pages
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Skip if this is a user-initiated change (not a navigation)
    if (isUserActionRef.current) {
      isUserActionRef.current = false;
      return;
    }

    const didNavigate = prevPathnameRef.current !== pathname;
    prevPathnameRef.current = pathname;

    // Only restore on actual page navigation
    if (!didNavigate) return;

    const urlState = searchParams.get(STATE_PARAM);
    const storedState = getStoredState();

    // If we navigated to a new page and have stored state but URL doesn't have it
    if (!urlState && Object.keys(storedState).length > 0) {
      const newParams = new URLSearchParams(searchParams.toString());
      const encoded = encodeState(storedState);
      if (encoded) {
        newParams.set(STATE_PARAM, encoded);
        router.replace(`${pathname}?${newParams.toString()}`);
      }
    } else if (urlState) {
      // URL has state from a shared link - sync to localStorage
      const decoded = decodeState(urlState);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(decoded));
    }
  }, [pathname, searchParams, router]);

  /**
   * Set the entire state, replacing any existing state.
   */
  const setState = useCallback(
    (newState: UrlState) => {
      // Mark this as a user action so the effect doesn't override it
      isUserActionRef.current = true;

      // Persist to localStorage
      if (Object.keys(newState).length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }

      // Update URL
      const newParams = new URLSearchParams(searchParams.toString());
      // Remove legacy params
      newParams.delete("project");
      newParams.delete("showBacklog");

      const encoded = encodeState(newState);
      if (encoded) {
        newParams.set(STATE_PARAM, encoded);
      } else {
        newParams.delete(STATE_PARAM);
      }

      const queryString = newParams.toString();
      router.push(queryString ? `${pathname}?${queryString}` : pathname);
    },
    [searchParams, pathname, router]
  );

  /**
   * Set a single property in the state, preserving other properties.
   */
  const setProperty = useCallback(
    <K extends keyof UrlState>(key: K, value: UrlState[K]) => {
      const currentState = getStoredState();
      const newState: UrlState = { ...currentState, [key]: value };

      // Remove undefined values
      if (value === undefined) {
        delete newState[key];
      }

      setState(newState);
    },
    [setState]
  );

  return {
    state,
    setState,
    setProperty,
  };
}
