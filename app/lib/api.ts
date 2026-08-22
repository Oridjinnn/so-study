// Single choke-point for every authenticated client request.
//
// The app is a local-first study tool for exactly two trusted people, but the
// 90-day session cookie still expires, and `SESSION_SECRET` can be rotated.
// Rather than let ~15 call sites each guess at a 401 (and risk silent empty
// lists or a cryptic error), they ALL funnel through here so the ONE place that
// decides "your session is gone, go log in" lives here.
//
// Why a module-level latch and not a try/catch in every component: a session
// that lapses mid-use fans out many in-flight requests that 401 at once. Without
// a guard, every one would call `window.location.assign` and the browser would
// thrash between identical navigations. `redirecting` lets only the FIRST 401 in
// a page lifetime trigger the redirect.
//
// Why 503 does NOT redirect: a missing `SESSION_SECRET` is a server misconfig,
// not a login problem. Bouncing to /login would loop forever (login can't help),
// so we hand the raw response back and let the call site's ordinary `!res.ok`
// path surface it as a normal error.

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// Latch: once we've decided to send the student to /login we must not schedule a
// second navigation from a concurrent 401. Reset is only for tests.
let redirecting = false;

function redirectToLogin(): void {
  // Preserve where the student was so proxy.ts can bounce them straight back
  // after re-auth. A standalone PWA launch always starts at "/", so this is the
  // deep path they were on, not a manufactured one.
  const next = `${window.location.pathname}${window.location.search}`;
  // Hard navigation (not router.push): we MUST bust the cached app shell and
  // re-run the proxy auth gate from a clean slate, so a soft client transition
  // that reuses the stale shell would just 401 again.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional hard nav to re-run proxy auth gate
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);

  if (res.status === 401) {
    if (!redirecting) {
      redirecting = true;
      redirectToLogin();
    }
    // The caller's catch still runs; give it a typed, human error so the brief
    // flash of UI before navigation is honest rather than a raw stack trace.
    throw new ApiError("Sesi berakhir. Silakan masuk kembali.", 401);
  }

  // 503 and every other status pass straight through untouched.
  return res;
}

/** Test-only: clear the redirect latch between cases that assert the guard. */
export function __resetApiFetchRedirect(): void {
  redirecting = false;
}
