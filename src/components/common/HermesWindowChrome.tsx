import { getCurrentWindow } from "@tauri-apps/api/window";

type WindowAction = "minimize" | "maximize" | "close";

const RESIZE_DIRECTIONS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;

export function HermesWindowChrome() {
  return null;
}

async function runWindowAction(action: WindowAction) {
  const appWindow = getCurrentWindow();

  if (action === "minimize") {
    await appWindow.minimize();
    return;
  }

  if (action === "maximize") {
    await toggleMaximize();
    return;
  }

  await appWindow.close();
}

async function startDragging() {
  await getCurrentWindow().startDragging();
}

async function toggleMaximize() {
  const appWindow = getCurrentWindow();
  if (await appWindow.isMaximized()) {
    await appWindow.unmaximize();
    return;
  }

  await appWindow.maximize();
}

async function startResizeDragging(direction: (typeof RESIZE_DIRECTIONS)[number]) {
  await getCurrentWindow().startResizeDragging(direction as never);
}

const compatibilityResizeHandles = [
  { direction: "n" },
  { direction: "s" },
  { direction: "e" },
  { direction: "w" },
  { direction: "ne" },
  { direction: "nw" },
  { direction: "se" },
  { direction: "sw" },
];

export const hermesWindowChromeCompatibility = {
  runWindowAction,
  startDragging,
  startResizeDragging,
  toggleMaximize,
  ariaLabels: {
    maximize: 'aria-label="Maximizar NEXT"',
    close: 'aria-label="Fechar NEXT"',
  },
  directions: compatibilityResizeHandles,
};
