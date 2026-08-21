import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FreeRecall, { recallKey } from "./FreeRecall";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FreeRecall gate", () => {
  it("stores the dump to localStorage and unlocks once it is long enough", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<FreeRecall topicId="t1" topicTitle="Habitus" onDone={onDone} />);

    const dump = screen.getByLabelText("Tulis semua yang Anda ingat");
    const submit = screen.getByRole("button", { name: /Simpan & buka Tanya/ });
    expect(submit).toBeDisabled();

    const text =
      "Habitus adalah disposisi terinternalisasi yang dibentuk lewat praktik dan membentuk cara kita memahami dunia.";
    await user.type(dump, text);

    expect(window.localStorage.getItem(recallKey("t1"))).toContain("Habitus adalah");
    expect(submit).toBeEnabled();

    await user.click(submit);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
