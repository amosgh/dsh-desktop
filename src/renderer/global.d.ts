import type { DesktopApi } from "../shared/contracts";

declare global {
  interface Window {
    dshDesktop: DesktopApi;
  }
}

export {};
