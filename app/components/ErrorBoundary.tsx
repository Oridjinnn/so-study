"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (process.env.NODE_ENV !== "production") {
      console.error("ErrorBoundary caught a render error:", error, info);
    }
  }

  reset = (): void => {
    this.setState({ hasError: false, message: "" });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        className="m-4 rounded-2xl border border-red-300 bg-red-50 p-6 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
      >
        <h2 className="text-base font-semibold">Terjadi kesalahan</h2>
        <p className="mt-1">
          Sebagian tampilan tidak dapat dimuat. Coba muat ulang bagian ini.
        </p>
        {this.state.message ? (
          <p className="mt-2 break-words font-mono text-xs opacity-80">
            {this.state.message}
          </p>
        ) : null}
        <button
          type="button"
          onClick={this.reset}
          className="mt-4 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-red-500"
        >
          Coba lagi
        </button>
      </div>
    );
  }
}
