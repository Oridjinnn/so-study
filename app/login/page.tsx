import LoginForm from "./LoginForm";

export const metadata = {
  title: "Masuk — So-study",
  // The login screen is never a useful search result and must never be cached by
  // an intermediary: it is the one page that changes what the next page shows.
  robots: { index: false, follow: false },
};

/**
 * The only unauthenticated page in the app (see proxy.ts).
 *
 * A Server Component so the `next` destination is resolved before the first
 * paint — an installed PWA that cold-launches into a protected URL lands here,
 * logs in, and continues to where the student was actually going, instead of
 * being dumped on the dashboard.
 *
 * There is NO "create account" link. Users exist only via
 * `node scripts/seed-users.mjs` — this deployment is for two known people, and a
 * signup form would be the one thing that turns it into a public service.
 */
export default async function LoginPage({
  // Typed explicitly rather than via the generated `PageProps<'/login'>` helper:
  // that helper only exists after route typegen has run, and `scripts/ci.sh`
  // typechecks without a build step. The shape is the documented one
  // (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md).
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const raw = params?.next;
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  // Only same-origin, absolute-path redirects. Anything else (`//evil.test`, a
  // full URL, a scheme) is discarded: an open redirect on a login page is how a
  // phishing link borrows your domain.
  const next =
    typeof candidate === "string" && candidate.startsWith("/") && !candidate.startsWith("//")
      ? candidate
      : "/";

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">So-study</h1>
        <p className="mt-1 text-sm text-muted">
          Kit belajar pra-kuliah. Masuk dengan kata sandi yang kamu terima.
        </p>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
