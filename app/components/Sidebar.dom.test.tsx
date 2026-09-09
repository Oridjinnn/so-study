import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Sidebar from "./Sidebar";
import type { CourseSummary } from "../lib/types";

const COURSES: CourseSummary[] = [
  {
    id: "c1",
    name: "Kursus Antropologi",
    modules: [{ id: "m1", title: "Modul 1", status: "ready", topicId: "t1" }],
    topics: [],
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Sidebar", () => {
  it("renders the course nav and a responsive hamburger trigger", () => {
    render(<Sidebar courses={COURSES} activeCourseId={null} onSelectCourse={() => {}} onNew={() => {}} />);
    expect(screen.getByText("Kursus Antropologi")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Daftar mata kuliah/ })).toBeInTheDocument();
  });

  it("selects a course via the nav", async () => {
    const user = userEvent.setup();
    const onSelectCourse = vi.fn();
    render(<Sidebar courses={COURSES} activeCourseId={null} onSelectCourse={onSelectCourse} onNew={() => {}} />);
    await user.click(screen.getByText("Kursus Antropologi"));
    expect(onSelectCourse).toHaveBeenCalledWith("c1");
  });

  it("toggles a .dark class on <html> when the theme button is clicked", async () => {
    const user = userEvent.setup();
    document.documentElement.classList.remove("dark", "light");
    render(<Sidebar courses={COURSES} activeCourseId={null} onSelectCourse={() => {}} onNew={() => {}} />);

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    await user.click(screen.getByRole("button", { name: /Tema/ }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
