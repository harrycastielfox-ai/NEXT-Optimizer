import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { X } from "lucide-react";
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  NEX_COMPANION_SETTINGS_EVENT,
  NEX_COMPANION_STATE_EVENT,
  areNexCompanionSettingsEqual,
  isTauriRuntime,
  publishNexCompanionSettingsChange,
  readNexOptimizationState,
  subscribeToLocalOptimizationState,
} from "@/lib/nex-companion";
import { useHermesPreferences } from "@/lib/preferences";
import {
  DEFAULT_NEX_OPTIMIZATION_STATE,
  type NexCompanionSettings,
  type NexOptimizationState,
} from "@/types/nex-companion";

import { NexMascot } from "./NexMascot";
import { NexProgressRing } from "./NexProgressRing";
import "./nex-companion.css";

export function NexCompanion() {
  const { preferences, updatePreferences } = useHermesPreferences();
  const settings = useMemo(
    () => ({ ...preferences.companion, compactMode: true }),
    [preferences.companion],
  );
  const [optimization, setOptimization] = useState<NexOptimizationState>(() =>
    readNexOptimizationState(),
  );
  const positionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsRef = useRef(settings);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    setOptimization(readNexOptimizationState());
    const unsubscribeLocal = subscribeToLocalOptimizationState(setOptimization);
    if (!isTauriRuntime()) {
      return unsubscribeLocal;
    }

    const unlistenPromise = listen<NexOptimizationState>(NEX_COMPANION_STATE_EVENT, ({ payload }) =>
      setOptimization(payload),
    );

    return () => {
      unsubscribeLocal();
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    const unlistenPromise = listen<NexCompanionSettings>(
      NEX_COMPANION_SETTINGS_EVENT,
      ({ payload }) => {
        if (areNexCompanionSettingsEqual(settingsRef.current, payload)) {
          return;
        }
        settingsRef.current = payload;
        updatePreferences((current) => ({
          ...current,
          companion: payload,
        }));
      },
    );

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [updatePreferences]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    const unlistenPromise = getCurrentWindow().onMoved(({ payload }) => {
      if (positionTimerRef.current) {
        clearTimeout(positionTimerRef.current);
      }

      positionTimerRef.current = setTimeout(() => {
        const current = settingsRef.current;
        if (current.position?.x === payload.x && current.position?.y === payload.y) {
          return;
        }

        const next = {
          ...current,
          position: { x: payload.x, y: payload.y },
        };
        settingsRef.current = next;
        updatePreferences((preferences) => ({
          ...preferences,
          companion: next,
        }));
        void publishNexCompanionSettingsChange(next);
      }, 250);
    });

    return () => {
      if (positionTimerRef.current) {
        clearTimeout(positionTimerRef.current);
      }
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [updatePreferences]);

  const openMainWindow = useCallback((event?: MouseEvent<HTMLElement>) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (event && start) {
      const delta = Math.abs(event.screenX - start.x) + Math.abs(event.screenY - start.y);
      if (delta > 5) {
        return;
      }
    }

    if (isTauriRuntime()) {
      void invoke("nex_companion_open_main");
    }
  }, []);

  const startDragging = useCallback((event: MouseEvent<HTMLElement>) => {
    dragStartRef.current = { x: event.screenX, y: event.screenY };
    if (isTauriRuntime()) {
      void getCurrentWindow().startDragging();
    }
  }, []);

  const dismissErrorCompanion = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (optimization.status !== "error" || !isTauriRuntime()) {
        return;
      }

      void getCurrentWindow().hide();
    },
    [optimization.status],
  );

  const progress = Math.min(100, Math.max(0, Math.round(optimization.progress)));
  const canDismissError = optimization.status === "error";

  return (
    <main className={`nex-companion nex-companion--compact nex-companion--${optimization.status}`}>
      <div className="nex-companion-orb-wrap">
        <button
          className="nex-companion-orb"
          type="button"
          onClick={openMainWindow}
          onMouseDown={startDragging}
          aria-label={`NEXT Companion, ${progress}% concluído. Clique para abrir o NEXT.`}
          title="Arraste para mover. Clique para abrir o NEXT."
        >
          <span className="nex-companion-orb__aura" aria-hidden="true" />
          <NexProgressRing progress={progress} compact />
          <NexMascot status={optimization.status} compact />
          <span className="nex-companion-orb__percent">{progress}%</span>
          <span className="nex-companion__state-dot" aria-hidden="true" />
        </button>
        {canDismissError && (
          <button
            className="nex-companion-error-close"
            type="button"
            onClick={dismissErrorCompanion}
            aria-label="Fechar alerta do NEXT Companion"
            title="Fechar alerta"
          >
            <X size={13} strokeWidth={3} />
          </button>
        )}
      </div>
    </main>
  );
}

export function NexCompanionPreview() {
  return (
    <NexCompanionStaticState
      state={{
        ...DEFAULT_NEX_OPTIMIZATION_STATE,
        isRunning: true,
        progress: 63,
        currentStep: "Analisando disco",
        currentDetail: "Verificando integridade",
        status: "running",
      }}
    />
  );
}

function NexCompanionStaticState({ state }: { state: NexOptimizationState }) {
  return (
    <div className="nex-companion-preview" aria-hidden="true">
      <NexMascot status={state.status} compact />
      <NexProgressRing progress={state.progress} compact />
    </div>
  );
}
