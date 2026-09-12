export type SystemSecurityContext = {
  isWindows: boolean;
  isElevated: boolean;
  username?: string;
  warnings: string[];
};

export type SystemBootContext = {
  isWindows: boolean;
  available: boolean;
  currentBootId?: string;
  bootedAt?: string;
  warnings: string[];
};

export type SystemRestartRequest = {
  confirmed: boolean;
  dryRun?: boolean;
  delaySeconds?: number;
};

export type SystemRestartResult = {
  dryRun: boolean;
  scheduled: boolean;
  cancelled: boolean;
  delaySeconds?: number;
  message: string;
};

export const fallbackSystemSecurityContext: SystemSecurityContext = {
  isWindows: typeof navigator !== "undefined" ? /win/i.test(navigator.platform) : false,
  isElevated: false,
  warnings: ["Contexto administrativo indisponível fora do backend Tauri."],
};

export const fallbackSystemBootContext: SystemBootContext = {
  isWindows: typeof navigator !== "undefined" ? /win/i.test(navigator.platform) : false,
  available: false,
  warnings: ["Boot real indisponível fora do backend Tauri."],
};

export async function readSystemSecurityContext(): Promise<SystemSecurityContext> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return fallbackSystemSecurityContext;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<SystemSecurityContext>("system_security_context_read");
  } catch (error) {
    console.warn("Contexto administrativo indisponível.", error);
    return {
      ...fallbackSystemSecurityContext,
      warnings: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export async function readSystemBootContext(): Promise<SystemBootContext> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return fallbackSystemBootContext;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<SystemBootContext>("system_boot_context_read");
  } catch (error) {
    console.warn("Boot real indisponível.", error);
    return {
      ...fallbackSystemBootContext,
      warnings: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export async function openWindowsSecurity(): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    throw new Error("Segurança do Windows indisponível fora do aplicativo NEXT.");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("system_open_windows_security");
}

export async function requestSystemRestart(
  request: SystemRestartRequest,
): Promise<SystemRestartResult> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return {
      dryRun: true,
      scheduled: false,
      cancelled: false,
      delaySeconds: request.delaySeconds ?? 60,
      message: "Reinício validado fora do aplicativo Tauri. Nenhuma ação real foi executada.",
    };
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<SystemRestartResult>("system_restart_computer", { request });
}

export async function cancelSystemRestart(dryRun = true): Promise<SystemRestartResult> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return {
      dryRun: true,
      scheduled: false,
      cancelled: false,
      delaySeconds: 0,
      message: "Cancelamento validado fora do aplicativo Tauri. Nenhuma ação real foi executada.",
    };
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<SystemRestartResult>("system_cancel_restart", { dryRun });
}
