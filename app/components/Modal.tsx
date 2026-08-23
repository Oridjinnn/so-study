"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** id of an element inside `children` that labels the dialog (e.g. its heading). */
  labelledById?: string;
  /** extra classes for the dialog card (e.g. max-width / max-height). */
  className?: string;
  /** When true, closing via backdrop/Esc asks to confirm if a field has content. */
  confirmClose?: boolean;
}

function findUnsavedContent(dialog: HTMLElement | null): boolean {
  if (!dialog) return false;
  const fields = dialog.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    "input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
  );
  return Array.from(fields).some((field) => field.value.trim() !== "");
}

export default function Modal({
  open,
  title,
  onClose,
  children,
  labelledById,
  className,
  confirmClose = false,
}: ModalProps) {
  const generatedId = useId();
  const titleId = labelledById ?? `${generatedId}-title`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const confirmCloseRef = useRef(confirmClose);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  useEffect(() => {
    onCloseRef.current = onClose;
    confirmCloseRef.current = confirmClose;
  }, [onClose, confirmClose]);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current =
      (document.activeElement as HTMLElement | null) ?? null;

    const dialog = dialogRef.current;
    const focusables = dialog
      ? Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      : [];

    (focusables[0] ?? dialog)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function requestClose() {
      if (confirmCloseRef.current && findUnsavedContent(dialog)) {
        setConfirmingDiscard(true);
        return;
      }
      onCloseRef.current();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (confirmingDiscard) {
          setConfirmingDiscard(false);
          return;
        }
        requestClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const items = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      try {
        previouslyFocused.current?.focus?.();
      } catch {
        /* SSR-safe no-op */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={() => {
        if (confirmingDiscard) {
          setConfirmingDiscard(false);
          return;
        }
        if (confirmClose && findUnsavedContent(dialogRef.current)) {
          setConfirmingDiscard(true);
          return;
        }
        onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative w-full rounded-2xl bg-card shadow-xl outline-none ${
          className ?? ""
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        {labelledById ? null : (
          <div className="border-b border-border px-4 py-3">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
          </div>
        )}
        {children}

        {confirmingDiscard ? (
          <div
            role="alertdialog"
            aria-label="Buang perubahan?"
            className="flex items-center justify-between gap-3 border-t border-border px-4 py-3"
          >
            <span className="text-sm">Buang perubahan?</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmingDiscard(false);
                  onClose();
                }}
                className="rounded-xl bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-red-500"
              >
                Ya
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDiscard(false)}
                className="rounded-xl border border-border px-3 py-1.5 text-sm font-medium transition-colors duration-150 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Batal
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
