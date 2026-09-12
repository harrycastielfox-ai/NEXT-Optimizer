import { emitTo } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type {
  NexCompanionCommand,
  NexCompanionSettings,
  NexOptimizationState,
} from "@/types/nex-companion";
import { DEFAULT_NEX_OPTIMIZATION_STATE } from "@/types/nex-companion";

export const NEX_COMPANION_WINDOW_LABEL = "nex-companion";
export const NEX_COMPANION_STATE_EVENT = "nex://optimization-state";
export const NEX_COMPANION_COMMAND_EVENT = "nex://companion-command";
export const NEX_COMPANION_SETTINGS_EVENT = "nex://companion-settings";
export const NEX_COMPANION_SETTINGS_CHANGED_EVENT = "nex://companion-settings-changed";

const STATE_STORAGE_KEY = "nex.companion.optimization-state.v1";
const STATE_DOM_EVENT = "nex:optimization-state-updated";

export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function readNexOptimizationState(): NexOptimizationState {
  if (typeof window === "undefined") {
    return DEFAULT_NEX_OPTIMIZATION_STATE;
  }

  try {
    const raw = window.localStorage.getItem(STATE_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_NEX_OPTIMIZATION_STATE;
    }

    return normalizeOptimizationState(JSON.parse(raw) as Partial<NexOptimizationState>);
  } catch (error) {
    console.warn("Falha ao recuperar o estado do NEXT Companion.", error);
    return DEFAULT_NEX_OPTIMIZATION_STATE;
  }
}

export async function publishNexOptimizationState(state: NexOptimizationState) {
  const normalized = normalizeOptimizationState(state);

  if (typeof window !== "undefined") {
    window.localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent(STATE_DOM_EVENT, { detail: normalized }));
  }

  if (!isTauriRuntime()) {
    return;
  }

  await Promise.allSettled([
    emitTo(NEX_COMPANION_WINDOW_LABEL, NEX_COMPANION_STATE_EVENT, normalized),
    invoke("nex_companion_update_runtime", {
      isRunning: normalized.isRunning,
      status: normalized.status,
    }),
  ]);
}

export async function emitNexCompanionCommand(command: NexCompanionCommand) {
  if (!isTauriRuntime()) {
    return;
  }

  await emitTo("main", NEX_COMPANION_COMMAND_EVENT, command);
}

export async function syncNexCompanionSettings(settings: NexCompanionSettings) {
  if (!isTauriRuntime()) {
    return;
  }

  await Promise.allSettled([
    emitTo(NEX_COMPANION_WINDOW_LABEL, NEX_COMPANION_SETTINGS_EVENT, settings),
    invoke("nex_companion_update_settings", { settings }),
  ]);
}

export async function publishNexCompanionSettingsChange(settings: NexCompanionSettings) {
  if (!isTauriRuntime()) {
    return;
  }

  await emitTo("main", NEX_COMPANION_SETTINGS_CHANGED_EVENT, settings);
}

export function areNexCompanionSettingsEqual(
  left: NexCompanionSettings,
  right: NexCompanionSettings,
) {
  return (
    left.enabled === right.enabled &&
    left.showWhenMinimized === right.showWhenMinimized &&
    left.alwaysOnTop === right.alwaysOnTop &&
    left.hideInFullscreen === right.hideInFullscreen &&
    left.compactMode === right.compactMode &&
    left.clickThrough === right.clickThrough &&
    left.size === right.size &&
    left.position?.x === right.position?.x &&
    left.position?.y === right.position?.y &&
    left.position?.monitorId === right.position?.monitorId
  );
}

export function subscribeToLocalOptimizationState(listener: (state: NexOptimizationState) => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleState = (event: Event) => {
    const detail = (event as CustomEvent<NexOptimizationState>).detail;
    listener(normalizeOptimizationState(detail));
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STATE_STORAGE_KEY || !event.newValue) {
      return;
    }

    try {
      listener(normalizeOptimizationState(JSON.parse(event.newValue)));
    } catch {
      // Ignore partially written or invalid storage updates.
    }
  };

  window.addEventListener(STATE_DOM_EVENT, handleState);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(STATE_DOM_EVENT, handleState);
    window.removeEventListener("storage", handleStorage);
  };
}

function normalizeOptimizationState(
  value: Partial<NexOptimizationState> | null | undefined,
): NexOptimizationState {
  const progress = clampProgress(value?.progress);
  const steps = Array.isArray(value?.steps) ? value.steps : [];
  const status = value?.status ?? "idle";

  return {
    ...DEFAULT_NEX_OPTIMIZATION_STATE,
    ...value,
    progress,
    isRunning: status === "running" || status === "paused",
    completedSteps: Array.isArray(value?.completedSteps) ? value.completedSteps : [],
    pendingSteps: Array.isArray(value?.pendingSteps) ? value.pendingSteps : [],
    steps,
    updatedAt: value?.updatedAt ?? Date.now(),
  };
}

function clampProgress(value: unknown) {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}
