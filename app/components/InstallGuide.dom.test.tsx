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

describe("InstallGuide", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setStandalone(undefined);
  });

  it("shows the iOS install steps on a first Safari (non-standalone) visit", async () => {
    setUA(IPAD_UA);
    setStandalone(false);
    render(<InstallGuide />);
    expect(await screen.findByText(/Add to Home Screen/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tutup panduan/i })).toBeInTheDocument();
  });

  it("never shows once running standalone (already installed)", async () => {
    setUA(IPAD_UA);
    setStandalone(true);
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
