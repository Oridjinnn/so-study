import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MetacogPanel from "./MetacogPanel";
import { METACOG_PROMPTS } from "@/src/lib/metacog";

const TOPIC = "Teori Praktik Bourdieu";
const KEY = `metacog:${TOPIC}`;

function stored(): Record<string, string> {
  return JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
}

describe("MetacogPanel structure", () => {
  it("brackets the work with plan / monitor / evaluate phases", () => {
    render(<MetacogPanel topicTitle={TOPIC} />);
    expect(screen.getByRole("heading", { name: "Rencana" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pantau" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Evaluasi" })).toBeInTheDocument();
  });

  it("frames the reflection as pre-lecture preparation, not busywork", () => {
    render(<MetacogPanel topicTitle={TOPIC} />);
    expect(screen.getByText(/Head-start:/)).toBeInTheDocument();
    expect(screen.getByText(/siap saat kuliah/)).toBeInTheDocument();
  });

  it("renders a writing field for every plan and monitor prompt", () => {
    render(<MetacogPanel topicTitle={TOPIC} />);
    const written = METACOG_PROMPTS.filter((p) => p.phase !== "evaluasi").length;
    expect(screen.getAllByPlaceholderText("Tulis jawaban Anda…")).toHaveLength(written);
  });

  it("renders a 1–5 confidence scale for every evaluate prompt", () => {
    render(<MetacogPanel topicTitle={TOPIC} />);
    const evaluate = METACOG_PROMPTS.filter((p) => p.phase === "evaluasi").length;
    expect(screen.getAllByRole("button", { name: "3" })).toHaveLength(evaluate);
  });

  it("shows each prompt's question text", () => {
    render(<MetacogPanel topicTitle={TOPIC} />);
    for (const prompt of METACOG_PROMPTS) {
      expect(screen.getByText(prompt.text)).toBeInTheDocument();
    }
  });
});

describe("MetacogPanel autosave", () => {
  it("saves a written reflection to localStorage under the topic key", async () => {
    render(<MetacogPanel topicTitle={TOPIC} />);

    const first = screen.getAllByPlaceholderText("Tulis jawaban Anda…")[0];
    await userEvent.type(first, "Ingin paham habitus");

    expect(stored()["rencana-0"]).toBe("Ingin paham habitus");
  });

  it("saves a confidence rating and marks the chosen number as selected", async () => {
    render(<MetacogPanel topicTitle={TOPIC} />);

    await userEvent.click(screen.getAllByRole("button", { name: "4" })[0]);

    expect(stored()["evaluasi-0"]).toBe("4");
    expect(screen.getAllByRole("button", { name: "4" })[0].className).toContain("bg-indigo-600");
  });

  it("keeps reflections from different prompts side by side", async () => {
    render(<MetacogPanel topicTitle={TOPIC} />);
    const fields = screen.getAllByPlaceholderText("Tulis jawaban Anda…");

    await userEvent.type(fields[0], "A");
    await userEvent.type(fields[1], "B");

    expect(stored()).toMatchObject({ "rencana-0": "A", "rencana-1": "B" });
  });

  it("restores previously written reflections on remount", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ "rencana-0": "jawaban lama" }));
    render(<MetacogPanel topicTitle={TOPIC} />);
    expect(screen.getAllByPlaceholderText("Tulis jawaban Anda…")[0]).toHaveValue("jawaban lama");
  });

  it("scopes storage per topic so another topic's answers do not leak in", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ "rencana-0": "punya topik lain" }));
    render(<MetacogPanel topicTitle="Topik Berbeda" />);
    expect(screen.getAllByPlaceholderText("Tulis jawaban Anda…")[0]).toHaveValue("");
  });

  it("starts empty instead of crashing when stored JSON is corrupt", () => {
    window.localStorage.setItem(KEY, "{not json");
    render(<MetacogPanel topicTitle={TOPIC} />);
    expect(screen.getAllByPlaceholderText("Tulis jawaban Anda…")[0]).toHaveValue("");
  });
});
