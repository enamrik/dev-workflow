"use client";

import { createContext, useContext } from "react";
import {
  useRouter as useNextRouter,
  usePathname as useNextPathname,
  useSearchParams as useNextSearchParams,
} from "next/navigation";

export interface AppRouter {
  push: (url: string) => void;
  replace: (url: string) => void;
  prefetch: (url: string) => void;
  back: () => void;
  forward: () => void;
  refresh: () => void;
}

interface NavigationContextValue {
  router: AppRouter;
  pathname: string;
  searchParams: URLSearchParams;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

/**
 * Production provider — wraps real Next.js navigation hooks.
 */
export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const router = useNextRouter();
  const pathname = useNextPathname();
  const searchParams = useNextSearchParams();

  return (
    <NavigationContext.Provider value={{ router, pathname, searchParams }}>
      {children}
    </NavigationContext.Provider>
  );
}

/**
 * Test provider — accepts mock navigation values for testing without vi.mock.
 */
export function TestNavigationProvider({
  children,
  router,
  pathname = "/",
  searchParams,
}: {
  children: React.ReactNode;
  router?: Partial<AppRouter>;
  pathname?: string;
  searchParams?: URLSearchParams;
}) {
  const noopRouter: AppRouter = {
    push: () => {},
    replace: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
    ...router,
  };

  return (
    <NavigationContext.Provider
      value={{
        router: noopRouter,
        pathname,
        searchParams: searchParams ?? new URLSearchParams(),
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
}

/**
 * Hook to access navigation context.
 * Must be used within NavigationProvider or TestNavigationProvider.
 */
export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) {
    throw new Error("useNavigation must be used within NavigationProvider");
  }
  return ctx;
}
