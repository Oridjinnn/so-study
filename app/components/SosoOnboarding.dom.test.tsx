import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SosoOnboarding from "./SosoOnboarding";

interface FetchResponseLike {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}
type FetchLike = (url: string, init?: RequestInit) => Promise<FetchResponseLike>;

function stubFetch(response: FetchResponseLike) {
  const fn = vi.fn<FetchLike>(async () => response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

function created() {
  return { ok: true, status: 201, json: async () => ({ created: [], count: 2, duplicates: [] }) };
}

function bodyOf(init?: RequestInit): { names?: string[]; major?: string } {
  return JSON.parse(String(init?.body ?? "{}"));
}

describe("SosoOnboarding", () => {
  it("shows Screen 0 (name) first", () => {
    render(<SosoOnboarding onFinished={vi.fn()} />);
    expect(screen.getByText(/Siapa namamu/i)).toBeInTheDocument();
  });

  it("advances name → Soso and stores the trimmed name on the profile", async () => {
    const user = userEvent.setup();
    render(<SosoOnboarding onFinished={vi.fn()} />);

    await user.type(screen.getByLabelText(/Nama kamu/i), "   Budi   ");
    await user.click(screen.getByRole("button", { name: /Lanjut/i }));

    expect(await screen.findByText(/Halo Budi, aku Soso!/i)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("soso.profile") || "{}")).toMatchObject({
      name: "Budi",
    });
  });

  it("falls back to the generic greeting when the name is blank", async () => {
    const user = userEvent.setup();
    render(<SosoOnboarding onFinished={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Lanjut/i }));

    expect(await screen.findByText(/Halo, aku Soso!/i)).toBeInTheDocument();
    expect(localStorage.getItem("soso.profile")).toBeNull();
  });

  it("stores the university (trimmed) on the profile after the Soso screen", async () => {
    const user = userEvent.setup();
    render(<SosoOnboarding onFinished={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Lanjut/i }));
    await user.type(screen.getByLabelText(/Nama universitas/i), "   Universitas Gadjah Mada   ");
    await user.click(screen.getByRole("button", { name: /Lanjut/i }));

    expect(
      await screen.findByText(/Masukkan mata kuliah kamu di semester ini/i),
    ).toBeInTheDocument();
    // Whitespace-only doesn't count, and the stored value is trimmed.
    expect(JSON.parse(localStorage.getItem("soso.profile") || "{}")).toMatchObject({
      university: "Universitas Gadjah Mada",
    });
  });

  it("submits the batch to /api/courses and finishes", async () => {
    const onFinished = vi.fn();
    const fetchMock = stubFetch(created());
    const user = userEvent.setup();
    render(<SosoOnboarding onFinished={onFinished} />);

    await user.click(screen.getByRole("button", { name: /Lanjut/i }));
    await user.click(screen.getByRole("button", { name: /Lanjut/i }));
    await user.type(
      screen.getByPlaceholderText(/Teori Antropologi Kontemporer/i),
      "Teori A\nTeori B",
    );
    await user.click(screen.getByRole("button", { name: /Buat mata kuliah/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/courses");
    expect(init?.method).toBe("POST");
    expect(bodyOf(init).names).toEqual(["Teori A", "Teori B"]);
    expect(onFinished).toHaveBeenCalled();
  });

  it("sends the shared major from Screen 2", async () => {
    const fetchMock = stubFetch(created());
    const user = userEvent.setup();
    render(<SosoOnboarding onFinished={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Lanjut/i }));
    await user.click(screen.getByRole("button", { name: /Lanjut/i }));
    await user.type(screen.getByPlaceholderText(/Teori Antropologi Kontemporer/i), "Teori A");
    await user.type(screen.getByLabelText(/Jurusan/i), "Antropologi");
    await user.click(screen.getByRole("button", { name: /Buat mata kuliah/i }));

    expect(bodyOf(fetchMock.mock.calls[0][1]).major).toBe("Antropologi");
  });

  it("surfaces a collision error without finishing", async () => {
    stubFetch({
      ok: false,
      status: 409,
      json: async () => ({ error: "Mata kuliah ini sudah ada: X.", conflicts: ["X"] }),
    });
    const onFinished = vi.fn();
    const user = userEvent.setup();
    render(<SosoOnboarding onFinished={onFinished} />);

    await user.click(screen.getByRole("button", { name: /Lanjut/i }));
    await user.click(screen.getByRole("button", { name: /Lanjut/i }));
    await user.type(screen.getByPlaceholderText(/Teori Antropologi Kontemporer/i), "X");
    await user.click(screen.getByRole("button", { name: /Buat mata kuliah/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/sudah ada/);
    expect(onFinished).not.toHaveBeenCalled();
  });
});
