import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import InstallGuide from "./InstallGuide";

const IPAD_UA =
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const MAC_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function setUA(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
}
function setStandalone(v: boolean | undefined) {
  if (v === undefined) {
    // @ts-expect-error - deleting a non-standard property for the test
    delete window.navigator.standalone;
  } else {
    Object.defineProperty(window.navigator, "standalone", {
      value: v,
      configurable: true,
    });
  }
}
// iPadOS 17+ reports an installed app through the display-mode media query
// rather than the legacy navigator.standalone flag, so the guide must respect it.
function setDisplayMode(standalone: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: standalone && query.includes("standalone"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
}

describe("InstallGuide", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setStandalone(undefined);
    setDisplayMode(false);
  });

  it("shows the iOS install steps on a first Safari (non-standalone) visit", async () => {
    setUA(IPAD_UA);
    setStandalone(false);
    render(<InstallGuide />);
    expect(await screen.findByText(/Add to Home Screen/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tutup panduan/i })).toBeInTheDocument();
  });

  it("gives the steps a real standalone install needs (Safari, iPad share button, confirm, open from the icon)", async () => {
    setUA(IPAD_UA);
    setStandalone(false);
    render(<InstallGuide />);
    // Safari-only requirement: other iOS browsers cannot install.
    expect(await screen.findByText(/browser lain tidak bisa memasang/i)).toBeInTheDocument();
    // The share button lives in the top toolbar on iPad, not the bottom bar.
    expect(screen.getByText(/toolbar kanan atas/i)).toBeInTheDocument();
    // Indonesian iPads localise the menu entry, so both labels are given.
    expect(screen.getByText(/Tambah ke Layar Utama/i)).toBeInTheDocument();
    // Finishing the install means opening it from the home-screen icon.
    expect(screen.getByText(/ikon So-study di layar utama/i)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(4);
  });

  it("never shows once running standalone (already installed)", async () => {
    setUA(IPAD_UA);
    setStandalone(true);
    render(<InstallGuide />);
    expect(screen.queryByText(/Add to Home Screen/i)).not.toBeInTheDocument();
  });

  it("never shows when only display-mode reports standalone (iPadOS 17+)", async () => {
    setUA(IPAD_UA);
    setStandalone(undefined); // legacy flag absent
    setDisplayMode(true);
    render(<InstallGuide />);
    expect(screen.queryByText(/Add to Home Screen/i)).not.toBeInTheDocument();
  });

  it("does not show on non-iOS browsers", async () => {
    setUA(MAC_CHROME_UA);
    setStandalone(false);
    render(<InstallGuide />);
    expect(screen.queryByText(/Add to Home Screen/i)).not.toBeInTheDocument();
  });

  it("hides after dismissal and persists the choice", async () => {
    setUA(IPHONE_UA);
    setStandalone(false);
    render(<InstallGuide />);
    const close = await screen.findByRole("button", { name: /tutup panduan/i });
    fireEvent.click(close);
    expect(screen.queryByText(/Add to Home Screen/i)).not.toBeInTheDocument();
    expect(window.localStorage.getItem("so-study:install-dismissed")).toBe("1");
  });

  it("stays hidden on a later visit once dismissed", async () => {
    window.localStorage.setItem("so-study:install-dismissed", "1");
    setUA(IPAD_UA);
    setStandalone(false);
    render(<InstallGuide />);
    expect(screen.queryByText(/Add to Home Screen/i)).not.toBeInTheDocument();
  });
});
