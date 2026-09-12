import {
  BadgeCheck,
  CircleDollarSign,
  ExternalLink,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { getNexStoreUrl, openNexExternalUrl, useNexAuth } from "@/lib/nex-auth";

export function NexLicenseGate({ children }: { children: ReactNode }) {
  const {
    configured,
    loading,
    rememberedEmail,
    user,
    entitlement,
    deviceAccess,
    error,
    clearError,
    redeemCode,
    verifyEmailAccess,
  } = useNexAuth();
  const [email, setEmail] = useState(user?.email ?? rememberedEmail ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const internalQaBypass = import.meta.env.VITE_NEX_INTERNAL_QA_BYPASS === "true";
  const storeUrl = getNexStoreUrl();

  const entitlementExpired =
    entitlement?.status === "active" && new Date(entitlement.expiresAt).getTime() <= Date.now();
  const effectiveDeviceAccess = entitlementExpired ? "expired" : deviceAccess;
  const accessConfirmed =
    configured &&
    Boolean(user) &&
    entitlement?.status === "active" &&
    !entitlementExpired &&
    effectiveDeviceAccess === "allowed";

  useEffect(() => {
    const nextEmail = user?.email ?? rememberedEmail;
    if (!email.trim() && nextEmail) setEmail(nextEmail);
  }, [email, rememberedEmail, user?.email]);

  // Available only in an explicitly generated internal QA build. Public builds keep this false.
  if (internalQaBypass) return children;

  // Local development remains usable before cloud credentials exist. Packaged builds fail closed.
  if (!configured && import.meta.env.DEV) return children;

  if (accessConfirmed) return children;

  const checking = configured && (loading || effectiveDeviceAccess === "checking");
  const content = getBlockedContent({
    configured,
    checking,
    signedIn: Boolean(user),
    deviceAccess: effectiveDeviceAccess,
  });

  async function handleActivate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    clearError();

    try {
      const normalizedCode = code.trim();
      const activated = normalizedCode
        ? await redeemCode(normalizedCode, email)
        : await verifyEmailAccess(email);
      setCode("");
      setEmail(email.trim().toLowerCase());
      setNotice(`Acesso ${activated.planName} ativado. Entrando no NEXT...`);
    } catch (activationError) {
      setNotice(
        activationError instanceof Error ? activationError.message : String(activationError),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleBuy() {
    if (!storeUrl) {
      setNotice("A loja oficial do NEXT ainda não foi definida neste build.");
      return;
    }
    await openNexExternalUrl(storeUrl);
  }

  async function handleClose() {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
      return;
    }
    window.close();
  }

  return (
    <div className="lightning-bg grid min-h-screen place-items-center overflow-auto px-5 py-8">
      <section className="relative w-full max-w-[620px] overflow-hidden rounded-[28px] border border-primary/30 bg-card/90 p-5 shadow-[0_32px_90px_-46px_rgba(168,85,247,0.95)] backdrop-blur-xl sm:p-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(168,85,247,0.24),transparent_36%),radial-gradient(circle_at_100%_100%,rgba(255,255,255,0.07),transparent_30%)]" />
        <button
          type="button"
          aria-label="Fechar"
          onClick={() => void handleClose()}
          className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-xl border border-border/70 bg-background/60 text-muted-foreground transition hover:border-primary/45 hover:text-primary"
        >
          ×
        </button>

        <div className="relative text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary/15 text-primary shadow-[0_0_38px_rgba(168,85,247,0.32)]">
            {checking ? (
              <Loader2 className="h-7 w-7 animate-spin" />
            ) : effectiveDeviceAccess === "blocked" ? (
              <LockKeyhole className="h-7 w-7" />
            ) : (
              <ShieldCheck className="h-7 w-7" />
            )}
          </div>

          <p className="mt-5 text-[11px] font-black uppercase tracking-[0.28em] text-primary">
            NEXT
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-foreground">
            {checking ? "Validando acesso" : content.title}
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            {content.description}
          </p>
        </div>

        {(error || notice) && (
          <div className="relative mt-5 rounded-2xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm font-bold text-foreground">
            {error || notice}
          </div>
        )}

        <div className="relative mt-5 rounded-[22px] border border-border/70 bg-background/68 p-4">
          {checking ? (
            <div className="flex items-center justify-center gap-3 py-12 text-sm font-bold text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              Verificando licença e hardware...
            </div>
          ) : configured ? (
            <form onSubmit={handleActivate} className="space-y-3">
              <label className="block">
                <span className="mb-2 block text-left text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">
                  E-mail
                </span>
                <span className="flex h-12 items-center gap-3 rounded-2xl border border-primary/35 bg-card px-4 shadow-[0_0_0_1px_rgba(168,85,247,0.08)] transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
                  <Mail className="h-5 w-5 shrink-0 text-primary" />
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="cliente@email.com"
                    autoComplete="email"
                    className="min-w-0 flex-1 bg-transparent text-sm font-bold text-foreground outline-none placeholder:text-muted-foreground/55"
                  />
                </span>
              </label>

              <label className="block">
                <span className="mb-2 block text-left text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">
                  Código de acesso
                </span>
                <span className="flex h-12 items-center gap-3 rounded-2xl border border-border bg-card px-4 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
                  <KeyRound className="h-5 w-5 shrink-0 text-primary" />
                  <input
                    value={code}
                    onChange={(event) => setCode(event.target.value.toUpperCase())}
                    placeholder="Opcional se este PC já estiver ativado"
                    autoComplete="off"
                    spellCheck={false}
                    className="min-w-0 flex-1 bg-transparent font-mono text-sm font-black uppercase tracking-[0.08em] text-foreground outline-none placeholder:text-muted-foreground/45"
                  />
                </span>
              </label>

              <button
                type="submit"
                disabled={busy || email.trim().length < 5}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-sm font-black text-primary-foreground shadow-[0_18px_42px_-24px_rgba(168,85,247,0.95)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <KeyRound className="h-5 w-5" />
                )}
                {busy ? "Validando..." : code.trim() ? "Ativar e entrar" : "Entrar"}
              </button>

              <button
                type="button"
                onClick={() => void handleBuy()}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-primary/25 bg-primary/10 px-5 text-sm font-black text-primary transition hover:border-primary/50 hover:bg-primary/15"
              >
                <CircleDollarSign className="h-4 w-4" />
                Ver planos
                <ExternalLink className="h-4 w-4" />
              </button>

              <p className="text-center text-xs leading-relaxed text-muted-foreground">
                Uma sessão salva neste PC permite entrar novamente. Se ela expirou, use o código
                original da compra. A troca de computador é atendida pelo suporte.
              </p>
            </form>
          ) : (
            <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm font-bold text-warning">
              Configure as chaves públicas do Supabase e reinicie o app para ativar o licenciamento
              online.
            </div>
          )}
        </div>

        <Link
          to="/seguranca"
          className="relative mt-4 block text-center text-sm text-primary underline"
        >
          Segurança e recuperação
        </Link>

        <div className="relative mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div className="flex items-center justify-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2">
            <BadgeCheck className="h-4 w-4 text-primary" />
            Código único por cliente
          </div>
          <div className="flex items-center justify-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Vinculado ao computador
          </div>
        </div>
      </section>
    </div>
  );
}

function getBlockedContent({
  configured,
  checking,
  signedIn,
  deviceAccess,
}: {
  configured: boolean;
  checking: boolean;
  signedIn: boolean;
  deviceAccess: ReturnType<typeof useNexAuth>["deviceAccess"];
}) {
  if (!configured) {
    return {
      title: "Servidor de licenças não configurado",
      description:
        "Este build não pode liberar o aplicativo até receber a configuração oficial do servidor NEXT.",
    };
  }
  if (checking) {
    return {
      title: "Validando seu acesso",
      description: "O NEXT está confirmando a licença e a identidade segura deste computador.",
    };
  }
  if (!signedIn) {
    return {
      title: "Entre para continuar",
      description: "Use o e-mail da compra e o código NEXT para liberar este computador.",
    };
  }
  if (deviceAccess === "blocked") {
    return {
      title: "Licença vinculada a outro PC",
      description:
        "Esta conta já está protegida em outro computador. O acesso permanece bloqueado nesta máquina.",
    };
  }
  if (deviceAccess === "expired") {
    return {
      title: "Seu acesso expirou",
      description: "Resgate um novo código para renovar o período de uso neste computador.",
    };
  }
  if (deviceAccess === "revoked") {
    return {
      title: "Acesso indisponível",
      description: "Esta licença foi revogada e não pode liberar o NEXT.",
    };
  }
  if (deviceAccess === "unavailable") {
    return {
      title: "Não foi possível validar a licença",
      description: "Por segurança, o NEXT fica bloqueado até o servidor confirmar este computador.",
    };
  }
  return {
    title: "Código de acesso necessário",
    description: "Resgate um código NEXT válido para vincular o acesso a este computador.",
  };
}
