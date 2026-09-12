import { AlertTriangle, CheckCircle2, Loader2, Power, RotateCcw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { HERMES_SAFE_TEST_MODE } from "@/lib/safe-mode";
import { cancelSystemRestart, requestSystemRestart, type SystemRestartResult } from "@/lib/system";

type RestartPromptProps = {
  phase: "prepare" | "optimize";
  onRestartRequested?: (result: SystemRestartResult) => void;
};

type RequestState = "idle" | "running" | "success" | "failed";

export function RestartPrompt({ phase, onRestartRequested }: RestartPromptProps) {
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [cancelState, setCancelState] = useState<RequestState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [restartResult, setRestartResult] = useState<SystemRestartResult | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  const isPrepare = phase === "prepare";
  const title =
    restartResult?.scheduled && countdown !== null
      ? `Reiniciando em ${countdown} segundo${countdown === 1 ? "" : "s"}`
      : isPrepare
        ? "Reinicie quando estiver pronto"
        : "Reinício final recomendado";
  const description = isPrepare
    ? "A Fase 1 terminou. Salve seu trabalho e escolha quando reiniciar para liberar a segunda etapa."
    : "A Fase 2 termina componentes, rede, perfil e Gamer. Reiniciar ajuda o Windows a consolidar os ajustes.";

  const handleRestart = useCallback(async () => {
    if (
      !HERMES_SAFE_TEST_MODE &&
      !window.confirm("Salvou seu trabalho? O Windows será reiniciado em 60 segundos.")
    ) {
      return;
    }
    setRequestState("running");
    setMessage(null);

    try {
      const result = await requestSystemRestart({
        confirmed: !HERMES_SAFE_TEST_MODE,
        dryRun: HERMES_SAFE_TEST_MODE,
        delaySeconds: 60,
      });
      setRestartResult(result);
      setCountdown(result.scheduled ? (result.delaySeconds ?? 60) : null);
      setMessage(result.message);
      setRequestState("success");
      onRestartRequested?.(result);
    } catch (error) {
      setRequestState("failed");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [onRestartRequested]);

  useEffect(() => {
    if (!restartResult?.scheduled || countdown === null || countdown <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCountdown((current) => (current === null ? null : Math.max(0, current - 1)));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [countdown, restartResult?.scheduled]);

  async function handleCancelRestart() {
    setCancelState("running");
    setMessage(null);

    try {
      const result = await cancelSystemRestart(HERMES_SAFE_TEST_MODE);
      setRestartResult(result);
      setCountdown(null);
      setMessage(result.message);
      setCancelState("success");
      setRequestState("idle");
    } catch (error) {
      setCancelState("failed");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section className="rounded-2xl border border-primary/25 bg-primary/10 p-4 text-foreground">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_14px_30px_-20px_rgba(37,99,235,0.9)]">
            <Power className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-black text-foreground">{title}</h3>
              <span className="inline-flex items-center gap-1 rounded-full border border-warning/20 bg-warning/10 px-2 py-1 text-[10px] font-bold text-warning">
                <AlertTriangle className="h-3 w-3" />
                {HERMES_SAFE_TEST_MODE ? "Simulado" : "Importante"}
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
              {description}
            </p>
            <p className="mt-2 inline-flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-success" />
              {HERMES_SAFE_TEST_MODE
                ? "Modo teste: o NEXT valida o comando, mas não reinicia o computador."
                : "O Windows reinicia em 60 segundos após sua confirmação. Você pode cancelar a contagem."}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0">
          {restartResult?.scheduled && (
            <button
              type="button"
              onClick={handleCancelRestart}
              disabled={cancelState === "running"}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-bold text-foreground transition hover:bg-muted disabled:opacity-60"
            >
              {cancelState === "running" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Cancelar
            </button>
          )}
          <button
            type="button"
            onClick={handleRestart}
            disabled={requestState === "running" || Boolean(restartResult?.scheduled)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-black text-primary-foreground shadow-[0_12px_28px_-18px_rgba(37,99,235,0.9)] transition hover:bg-primary/95 disabled:opacity-60"
          >
            {requestState === "running" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : requestState === "success" ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <Power className="h-4 w-4" />
            )}
            {HERMES_SAFE_TEST_MODE
              ? "Validar reinício"
              : restartResult?.scheduled && countdown !== null
                ? `${countdown}s`
                : "Reiniciar em 60s"}
          </button>
        </div>
      </div>

      {message && (
        <div
          aria-live="polite"
          className={`mt-3 rounded-xl border px-3 py-2 text-[12px] font-semibold ${
            requestState === "failed" || cancelState === "failed"
              ? "border-destructive/25 bg-destructive/10 text-destructive"
              : "border-success/25 bg-success/10 text-success"
          }`}
        >
          {message}
        </div>
      )}
    </section>
  );
}
