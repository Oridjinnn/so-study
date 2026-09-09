"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (message: string, type: Toast["type"]) => string;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;
function genId(): string {
  return `toast-${++nextId}-${Date.now()}`;
}

const TYPE_STYLES: Record<
  Toast["type"],
  { border: string; icon: string }
> = {
  success: { border: "border-green-500", icon: "✓" },
  error: { border: "border-red-500", icon: "✕" },
  info: { border: "border-brand-500", icon: "ℹ" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: Toast["type"]): string => {
    const id = genId();
    setToasts((prev) => [...prev, { id, message, type }]);
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

function ToastItem({
  toast,
  onRemove,
}: {
  toast: Toast;
  onRemove: (id: string) => void;
}) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    timerRef.current = window.setTimeout(() => {
      setExiting(true);
      timerRef.current = window.setTimeout(() => onRemove(toast.id), 300);
    }, 4000);
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, [toast.id, onRemove]);

  const style = TYPE_STYLES[toast.type];

  return (
    <div
      className={`${exiting ? "anim-toast-out" : "anim-toast-in"} border-l-4 ${style.border} bg-card rounded-r-card px-4 py-3 shadow-md flex items-center gap-3`}
    >
      <span className="text-lg leading-none" aria-hidden="true">
        {style.icon}
      </span>
      <span className="flex-1 text-sm">{toast.message}</span>
      <button
        type="button"
        onClick={() => {
          setExiting(true);
          timerRef.current = window.setTimeout(() => onRemove(toast.id), 300);
        }}
        className="text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Close notification"
      >
        ✕
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
      ))}
    </div>
  );
}