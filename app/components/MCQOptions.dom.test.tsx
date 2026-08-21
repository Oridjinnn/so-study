import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MCQOptions from "./MCQOptions";

describe("MCQOptions", () => {
  it("renders the options as a radio group and fires onSelect when chosen", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <MCQOptions
        options={["A", "B"]}
        chosen={null}
        answered={false}
        answer="A"
        onChoose={onSelect}
        name="grp"
      />,
    );

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);

    await user.click(screen.getByRole("radio", { name: "A" }));
    expect(onSelect).toHaveBeenCalledWith("A");
  });

  it("reveals a correct/incorrect marker once answered", () => {
    const { rerender } = render(
      <MCQOptions options={["A", "B"]} chosen="A" answered answer="A" onChoose={() => {}} name="grp" />,
    );
    expect(screen.getByText("benar")).toBeInTheDocument();

    rerender(
      <MCQOptions options={["A", "B"]} chosen="B" answered answer="A" onChoose={() => {}} name="grp" />,
    );
    expect(screen.getByText("salah")).toBeInTheDocument();
  });
});
