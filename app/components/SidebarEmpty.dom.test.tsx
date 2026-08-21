import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Sidebar from "./Sidebar";

describe("Sidebar empty state", () => {
  it("uses the correct two-word terminology when no courses exist", () => {
    render(<Sidebar courses={[]} activeCourseId={null} onSelectCourse={() => {}} onNew={() => {}} />);
    expect(screen.getByText(/Belum ada mata kuliah/)).toBeInTheDocument();
    // The old one-word spelling should not appear.
    expect(screen.queryByText("Belum ada matakuliah.")).not.toBeInTheDocument();
  });

  it("still offers the new-topic action from the empty state", async () => {
    const user = userEvent.setup();
    const onNew = vi.fn();
    render(<Sidebar courses={[]} activeCourseId={null} onSelectCourse={() => {}} onNew={onNew} />);
    await user.click(screen.getByRole("button", { name: /Topik baru/ }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });
});
