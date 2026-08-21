export type TabId = "read" | "ask" | "test" | "sources";

export const TAB_IDS: TabId[] = ["read", "ask", "test", "sources"];

// P0-2: in closed-book mode every reference tab is locked except the practice
// (Latih) tab, so the student must retrieve from memory, not consult sources.
export function visibleTabIds(closedBook: boolean): TabId[] {
  return closedBook ? ["test"] : TAB_IDS;
}

// Stable, URL-safe anchor id for a markdown heading (used by the TOC).
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}
