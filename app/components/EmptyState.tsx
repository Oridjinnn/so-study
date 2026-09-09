"use client";

import { type ReactNode } from "react";
import { PRIMARY_CLASS } from "./ui";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

const DEFAULT_ICON = (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

export default function EmptyState({
  icon = DEFAULT_ICON,
  title,
  description,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <div className={`empty-state ${className}`}>
      <div className="anim-fade-in-up">
        {icon}
        <h3 className="font-semibold text-foreground">{title}</h3>
        {description && <p className="text-sm text-muted">{description}</p>}
        {action && (
          <button className={PRIMARY_CLASS} onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}