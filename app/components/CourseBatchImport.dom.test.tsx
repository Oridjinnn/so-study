import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CourseBatchImport from "./CourseBatchImport";

interface FetchResponseLike {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}
type FetchLike = (url: string, init?: RequestInit) => Promise<FetchResponseLike>;

/** Stub `fetch` with one canned response and return the spy. */
function stubFetch(response: FetchResponseLike) {
  const fn = vi.fn<FetchLike>(async () => response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

function created(count: number) {
  return {
    ok: true,
    status: 201,
    json: async () => ({ created: [], count, duplicates: [] }),
  };
}

/** Parsed JSON body of a recorded call, without unsafe casts. */
function bodyOf(init?: RequestInit): { names?: string[]; major?: string } {
  return JSON.parse(String(init?.body ?? "{}"));
}

const LIST = /Teori Antropologi Kontemporer/;

describe("CourseBatchImport", () => {
  it("previews how many courses will be created from a pasted list", async () => {
    const user = userEvent.setup();
    render(<CourseBatchImport onClose={vi.fn()} onImported={vi.fn()} />);
    await user.type(
      screen.getByPlaceholderText(LIST),
      "Teori Antropologi Kontemporer\nAntropologi Ekologi\nEtnografi dan Metode Lapangan",
    );
    expect(await screen.findByText(/3 mata kuliah akan dibuat/)).toBeInTheDocument();
  });

  it("posts a single batch request and reports the count", async () => {
    const onImported = vi.fn();
    const fetchMock = stubFetch(created(3));
    const user = userEvent.setup();
    render(<CourseBatchImport onClose={vi.fn()} onImported={onImported} />);

    await user.type(screen.getByPlaceholderText(LIST), "a\nb\nc");
    await user.click(screen.getByRole("button", { name: /Impor 3/ }));

    // One request for the whole semester, not N sequential ones.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/courses");
    expect(init?.method).toBe("POST");
    expect(bodyOf(init).names).toEqual(["a", "b", "c"]);
    expect(onImported).toHaveBeenCalledWith(3);
  });

  it("dedupes a repeated name before sending", async () => {
    const fetchMock = stubFetch(created(1));
    const user = userEvent.setup();
    render(<CourseBatchImport onClose={vi.fn()} onImported={vi.fn()} />);

    await user.type(screen.getByPlaceholderText(LIST), "A\nA");
    await user.click(screen.getByRole("button", { name: /Impor 1/ }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock.mock.calls[0][1]).names).toEqual(["A"]);
  });

  it("accepts comma-separated names as well as newlines", async () => {
    const fetchMock = stubFetch(created(2));
    const user = userEvent.setup();
    render(<CourseBatchImport onClose={vi.fn()} onImported={vi.fn()} />);

    await user.type(screen.getByPlaceholderText(LIST), "Satu, Dua");
    await user.click(screen.getByRole("button", { name: /Impor 2/ }));

    expect(bodyOf(fetchMock.mock.calls[0][1]).names).toEqual(["Satu", "Dua"]);
  });

  it("sends the shared jurusan when provided", async () => {
    const fetchMock = stubFetch(created(1));
    const user = userEvent.setup();
    render(<CourseBatchImport onClose={vi.fn()} onImported={vi.fn()} />);

    await user.type(screen.getByPlaceholderText(LIST), "Satu");
    await user.type(screen.getByLabelText(/^Jurusan/), "Antropologi");
    await user.click(screen.getByRole("button", { name: /Impor 1/ }));

    expect(bodyOf(fetchMock.mock.calls[0][1]).major).toBe("Antropologi");
  });

  it("surfaces a 409 collision instead of swallowing it as a generic failure", async () => {
    stubFetch({
      ok: false,
      status: 409,
      json: async () => ({ error: "Mata kuliah ini sudah ada: X.", conflicts: ["X"] }),
    });
    const user = userEvent.setup();
    render(<CourseBatchImport onClose={vi.fn()} onImported={vi.fn()} />);

    await user.type(screen.getByPlaceholderText(LIST), "X");
    await user.click(screen.getByRole("button", { name: /Impor 1/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/sudah ada/);
  });

  it("refuses to submit an empty list", () => {
    render(<CourseBatchImport onClose={vi.fn()} onImported={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Impor/ })).toBeDisabled();
  });
});
