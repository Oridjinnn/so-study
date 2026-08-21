import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Composer from "./Composer";

afterEach(() => {
  vi.restoreAllMocks();
});

const COURSES = [{ id: "c1", name: "Kursus A", major: "Antropologi" }];

describe("Composer", () => {
  it("renders the form fields and a primary submit with an adequate tap target", () => {
    render(<Composer courses={COURSES} onCreate={() => {}} onClose={() => {}} busy={false} />);
    const submit = screen.getByRole("button", { name: /Sintesis/ });
    expect(submit).toBeInTheDocument();
    expect(submit.className).toContain("min-h-11");
    expect(screen.getByPlaceholderText(/Mis\. Teori Pertukaran/)).toBeInTheDocument();
  });

  it("calls onCreate with the title when submitted", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<Composer courses={COURSES} onCreate={onCreate} onClose={() => {}} busy={false} />);
    await user.type(screen.getByPlaceholderText(/Mis\. Teori Pertukaran/), "Topik Baru");
    await user.click(screen.getByRole("button", { name: /Sintesis/ }));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Topik Baru", keywords: [] }),
    );
  });

  it("asks for a jurusan when creating a new course, and submits it", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<Composer courses={COURSES} onCreate={onCreate} onClose={() => {}} busy={false} />);

    await user.type(screen.getByPlaceholderText(/Mis\. Teori Pertukaran/), "Topik Baru");
    await user.type(
      screen.getByPlaceholderText(/Buat mata kuliah baru/),
      "Antropologi Ekologi",
    );
    // The jurusan field appears only once it can be used.
    await user.type(screen.getByLabelText("Jurusan"), "Antropologi");
    await user.click(screen.getByRole("button", { name: /Sintesis/ }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Topik Baru",
        courseName: "Antropologi Ekologi",
        courseMajor: "Antropologi",
      }),
    );
  });

  it("does not ask for a jurusan when the picked course already has one", async () => {
    const user = userEvent.setup();
    render(
      <Composer
        courses={COURSES}
        defaultCourseId="c1"
        onCreate={() => {}}
        onClose={() => {}}
        busy={false}
      />,
    );
    // Re-asking would imply the major can be changed here, which the API refuses.
    expect(screen.queryByLabelText("Jurusan")).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/Buat mata kuliah baru/), "Kursus Baru");
    expect(screen.getByLabelText("Jurusan")).toBeInTheDocument();
  });

  it("offers to backfill a jurusan for a selected course that has none", () => {
    render(
      <Composer
        courses={[{ id: "c2", name: "Kursus Tanpa Jurusan", major: null }]}
        defaultCourseId="c2"
        onCreate={() => {}}
        onClose={() => {}}
        busy={false}
      />,
    );
    expect(screen.getByLabelText("Jurusan")).toBeInTheDocument();
  });
});
