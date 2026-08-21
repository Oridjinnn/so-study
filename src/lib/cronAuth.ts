/**
 * Shared guard for Vercel cron-triggered routes. When CRON_SECRET is set
 * (production) the caller must send a matching `x-cron-secret` or
 * `Authorization: Bearer …` header; when it is unset (local dev) any request
 * is allowed so local runs and tests don't need the secret.
 */
export function checkSecret(request: Request, secret: string | undefined): boolean {
  if (!secret) return true;
  const provided =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  return provided === secret;
}
