/**
 * True only when the app is running as an installed Home-Screen (standalone)
 * PWA. iOS web push and the install-gated features depend on this — a regular
 * browser tab is NOT a valid context. Shared so the install hint and the push
 * opt-in detect standalone state from one place (see <InstallGuide>).
 */
export function isStandalone(): boolean {
  if (typeof window === "undefined" || !window.navigator) return false;
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}
