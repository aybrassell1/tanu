type BackRouter = {
  canGoBack(): boolean;
  back(): void;
  replace(href: string): void;
};

/**
 * Goes back when there is somewhere to go back to, otherwise replaces the
 * current route with `fallback`. Screens opened directly (a reload or deep
 * link) have no history, and a bare `router.back()` throws "GO_BACK was not
 * handled" there.
 */
export function goBackOr(router: BackRouter, fallback: string) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
