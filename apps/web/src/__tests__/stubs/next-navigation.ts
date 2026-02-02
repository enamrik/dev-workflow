/**
 * Vitest stub for next/navigation.
 * Provides no-op implementations of Next.js navigation hooks.
 * Registered via vitest.config.ts resolve alias.
 *
 * Components that need controllable navigation should use
 * useNavigation() from NavigationContext instead.
 */

const noop = () => {};

export function useRouter() {
  return {
    push: noop,
    replace: noop,
    prefetch: noop,
    back: noop,
    forward: noop,
    refresh: noop,
  };
}

export function usePathname() {
  return "/";
}

export function useSearchParams() {
  return new URLSearchParams();
}

export function useParams() {
  return {};
}
