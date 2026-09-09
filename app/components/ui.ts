export const INPUT_CLASS =
  "w-full rounded-card border border-[var(--warm-border)] bg-[var(--warm-card)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--warm-brand)] dark:bg-zinc-800";

/* Shared button base: 44px tap target (`.tap` + `min-h-11`), `rounded-card`,
   ~150ms micro-interactions, subtle hover shadow, gentle press feedback, and a
   visible brand focus ring. `motion-reduce:*` keeps vestibular users at the
   instant resting state. Every button variant below is built on this so the
   whole app speaks one interaction language. */
const BTN_BASE =
  "tap inline-flex min-h-11 items-center justify-center gap-2 rounded-card px-4 py-2.5 text-sm font-medium transition-[box-shadow,transform,background-color,color] duration-150 hover:shadow-sm active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[var(--warm-brand)] focus-visible:outline-none motion-reduce:transition-none motion-reduce:active:scale-100 disabled:opacity-50 disabled:pointer-events-none";

export const PRIMARY_CLASS = `${BTN_BASE} bg-[var(--warm-brand-600)] text-white hover:bg-[var(--warm-brand-700)]`;

export const SECONDARY_CLASS = `${BTN_BASE} border border-[var(--warm-border)] text-[var(--warm-muted)] hover:bg-[var(--warm-border)] dark:hover:bg-zinc-800`;

export const GHOST_CLASS = `${BTN_BASE} px-3 text-[var(--warm-muted)] hover:bg-[var(--warm-border)] dark:hover:bg-zinc-800`;

export const CHIP_CLASS =
  "tap inline-flex min-h-11 items-center justify-center rounded-card border border-[var(--warm-border)] px-2 py-1 text-xs font-medium text-[var(--warm-muted)] transition hover:bg-[var(--warm-border)] focus-visible:ring-2 focus-visible:ring-[var(--warm-brand)] focus-visible:outline-none motion-reduce:transition-none motion-reduce:active:scale-100 dark:hover:bg-zinc-800";

export const DANGER_CLASS = `${BTN_BASE} bg-[var(--warm-red)] text-white hover:bg-[var(--warm-red)]/80`;

export const SUCCESS_CLASS = `${BTN_BASE} bg-[var(--warm-emerald)] text-white hover:bg-[var(--warm-emerald)]/80`;

export const EMPTY_ICON_CLASS = "text-[var(--warm-muted)] opacity-50";