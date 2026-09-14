import { createFileRoute } from "@tanstack/react-router";
import {
  BadgeCheck,
  CalendarDays,
  Check,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  KeyRound,
  Mail,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import {
  getNexStoreUrl,
  NEX_PLANS,
  openNexExternalUrl,
  useNexAuth,
  type NexPlan,
} from "@/lib/nex-auth";

export const Route = createFileRoute("/conta")({
  head: () => ({
    meta: [
      { title: "NEXT - Minha conta" },
      { name: "description", content: "Conta, código de acesso e assinatura NEXT." },
    ],
  }),
  component: AccountPage,
});

function AccountPage() {
  const {
    configured,
    loading,
    user,
    entitlement,
    deviceIdentity,
    deviceAccess,
    error,
    redeemCode,
    refreshEntitlement,
    clearError,
  } = useNexAuth();
  const [email, setEmail] = useState(user?.email ?? "");
  const [code, setCode] = useState("");
  const [showActivationForm, setShowActivationForm] = useState(false);
  const [busy, setBusy] = useState<"activate" | "refresh" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const storeUrl = getNexStoreUrl();
  const hasActiveAccess = entitlement?.status === "active" && deviceAccess === "allowed";
  const remainingDays = useMemo(() => {
    if (!entitlement || entitlement.status !== "active") return 0;
    return Math.max(
      0,
      Math.ceil((new Date(entitlement.expiresAt).getTime() - Date.now()) / 86_400_000),
    );
  }, [entitlement]);

  useEffect(() => {
    if (user?.email && !code.trim()) setEmail(user.email);
  }, [code, user?.email]);

  async function handleActivate(event: FormEvent) {
    event.preventDefault();
    setBusy("activate");
    setNotice(null);
    clearError();
    try {
      const activated = await redeemCode(code, email);
      setCode("");
      setEmail(user?.email ?? email.trim().toLowerCase());
      setShowActivationForm(false);
      setNotice(`Acesso ${activated.planName} ativado com sucesso.`);
    } catch (activationError) {
      setNotice(
        activationError instanceof Error ? activationError.message : String(activationError),
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleRefresh() {
    setBusy("refresh");
    clearError();
    try {
      await refreshEntitlement({ force: true });
    } finally {
      setBusy(null);
    }
  }

  async function handleBuy() {
    if (!storeUrl) {
      setNotice("A loja será conectada assim que o endereço oficial do site NEXT for definido.");
      return;
    }
    await openNexExternalUrl(storeUrl);
  }

  async function handleRevalidateAccess() {
    await refreshEntitlement({ force: true });
  }

  return (
    <div className="lightning-bg flex min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-auto px-5 py-6 xl:px-8 xl:py-7">
        <div className="mx-auto w-full max-w-[1320px]">
          <header className="flex flex-col gap-4 border-b border-border/60 pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-primary">
                NEXT ID
              </p>
              <h1 className="mt-2 text-[clamp(27px,2.4vw,38px)] font-black tracking-tight text-foreground">
                Minha conta
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Ative com e-mail e código de acesso. Depois da primeira ativação, o NEXT entra
                automaticamente neste computador enquanto a sessão estiver válida. Guarde o código
                original para reativar.
              </p>
            </div>
            <button
              type="button"
              onClick={handleBuy}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-black text-primary-foreground shadow-[0_16px_34px_-20px_rgba(168,85,247,0.95)] transition hover:brightness-110"
            >
              <CircleDollarSign className="h-4 w-4" />
              Comprar acesso
              <ExternalLink className="h-4 w-4" />
            </button>
          </header>

          {!configured && (
            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-4 text-warning">
              <KeyRound className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-bold">Servidor de contas aguardando configuração</p>
                <p className="mt-1 text-sm opacity-85">
                  Defina as chaves públicas do Supabase e reinicie o dev server para ativar o
                  licenciamento online.
                </p>
              </div>
            </div>
          )}

          {(error || notice) && (
            <div className="mt-5 rounded-2xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm font-semibold text-foreground">
              {error || notice}
            </div>
          )}

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)]">
            <section className="rounded-2xl border border-border/70 bg-card/80 p-5 shadow-[0_20px_48px_-36px_rgba(168,85,247,0.8)] backdrop-blur">
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
                  <UserRound className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-lg font-black text-foreground">Identidade NEXT</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Sua compra e seus códigos ficam vinculados ao e-mail e ao primeiro computador
                    ativado.
                  </p>
                </div>
              </div>

              {loading ? (
                <div className="mt-6 flex items-center gap-3 rounded-xl border border-border/70 bg-background/70 p-4 text-sm text-muted-foreground">
                  <RefreshCw className="h-4 w-4 animate-spin text-primary" /> Verificando acesso...
                </div>
              ) : user ? (
                <div className="mt-6 space-y-4">
                  <div className="flex flex-col gap-4 rounded-xl border border-border/70 bg-background/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-11 w-11 place-items-center rounded-full bg-primary/15 text-primary">
                        <Mail className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-bold text-foreground">{user.email}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Login automático ativo neste computador.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRevalidateAccess()}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-bold text-foreground transition hover:border-primary/40"
                    >
                      <RefreshCw className="h-4 w-4" /> Revalidar
                    </button>
                  </div>

                  {deviceIdentity && (
                    <div className="flex items-center gap-3 rounded-xl border border-success/25 bg-success/5 px-4 py-3">
                      <ShieldCheck className="h-5 w-5 shrink-0 text-success" />
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase tracking-wider text-success">
                          Computador vinculado
                        </p>
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">
                          {deviceIdentity.label}. A identidade da máquina é enviada como hash, junto
                          aos dados de ativação.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {hasActiveAccess && !showActivationForm ? (
                <button
                  type="button"
                  onClick={() => setShowActivationForm(true)}
                  className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 text-xs font-black text-primary transition hover:border-primary/55 hover:bg-primary/15"
                >
                  <KeyRound className="h-4 w-4" />
                  Adicionar tempo com outro código
                </button>
              ) : (
                <form
                  onSubmit={handleActivate}
                  className="mt-6 rounded-xl border border-primary/25 bg-primary/5 p-4"
                >
                  <label htmlFor="license-email" className="text-sm font-black text-foreground">
                    {hasActiveAccess ? "Adicionar tempo" : "Ativar acesso"}
                  </label>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Use o e-mail da compra e o código recebido. O código é de uso único.
                  </p>
                  <div className="mt-3 grid gap-2 xl:grid-cols-[minmax(260px,1.1fr)_minmax(240px,0.9fr)_auto]">
                    <input
                      id="license-email"
                      required
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="cliente@email.com"
                      autoComplete="email"
                      className="h-11 min-w-0 rounded-xl border border-border bg-background px-4 text-sm font-bold text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                    <input
                      id="license-code"
                      required
                      value={code}
                      onChange={(event) => setCode(event.target.value.toUpperCase())}
                      placeholder="NEX-XXXX-XXXX-XXXX"
                      autoComplete="off"
                      spellCheck={false}
                      className="h-11 min-w-0 rounded-xl border border-border bg-background px-4 font-mono text-sm font-bold uppercase tracking-[0.08em] text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                    <button
                      type="submit"
                      disabled={busy === "activate" || code.trim().length < 8}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-black text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <KeyRound className="h-4 w-4" />
                      {busy === "activate" ? "Validando..." : "Ativar"}
                    </button>
                  </div>
                </form>
              )}
            </section>

            <section className="rounded-2xl border border-border/70 bg-card/80 p-5 backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
                    <BadgeCheck className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="text-lg font-black text-foreground">Seu acesso</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Status confirmado pelo servidor NEXT.
                    </p>
                  </div>
                </div>
                {user && (
                  <button
                    type="button"
                    onClick={() => void handleRefresh()}
                    title="Atualizar licença"
                    className="grid h-9 w-9 place-items-center rounded-xl border border-border text-muted-foreground transition hover:border-primary/40 hover:text-primary"
                  >
                    <RefreshCw className={`h-4 w-4 ${busy === "refresh" ? "animate-spin" : ""}`} />
                  </button>
                )}
              </div>

              {deviceAccess === "blocked" ? (
                <StatusBox
                  tone="danger"
                  title="Licença vinculada a outro PC"
                  text="Este e-mail possui acesso ativo em outra máquina. Será necessário liberar uma troca de dispositivo pelo suporte."
                />
              ) : deviceAccess === "unavailable" && user ? (
                <StatusBox
                  tone="warning"
                  title="Verificação indisponível"
                  text="O NEXT mantém as otimizações bloqueadas até confirmar a licença e este computador."
                />
              ) : entitlement ? (
                <div className="mt-6">
                  <div
                    className={`rounded-2xl border p-5 ${
                      entitlement.status === "active"
                        ? "border-success/30 bg-success/10"
                        : "border-warning/30 bg-warning/10"
                    }`}
                  >
                    <div className="flex items-center gap-2 text-sm font-black">
                      <ShieldCheck className="h-5 w-5" />
                      {entitlement.status === "active"
                        ? "Acesso ativo"
                        : entitlement.status === "revoked"
                          ? "Acesso revogado"
                          : "Acesso expirado"}
                    </div>
                    <p className="mt-4 text-3xl font-black text-foreground">
                      {remainingDays}{" "}
                      <span className="text-base text-muted-foreground">dias restantes</span>
                    </p>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                      <InfoItem icon={CalendarDays} label="Plano" value={entitlement.planName} />
                      <InfoItem
                        icon={Clock3}
                        label="Válido até"
                        value={formatDate(entitlement.expiresAt)}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-xl border border-dashed border-border p-5 text-center">
                  <Clock3 className="mx-auto h-7 w-7 text-muted-foreground" />
                  <p className="mt-3 font-bold text-foreground">Nenhum plano ativo</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Compre um plano ou resgate um código para liberar o acesso.
                  </p>
                </div>
              )}
            </section>
          </div>

          <section className="mt-5 rounded-2xl border border-border/70 bg-card/80 p-5">
            <h2 className="font-black text-foreground">Troca de computador e recuperação</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              A troca é feita pelo suporte após verificar a compra e a titularidade. Tenha o número
              do pedido e o código original em mãos. Não envie o código em canais públicos. Informar
              apenas o e-mail não autoriza a troca.
            </p>
          </section>

          <section className="mt-5">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-primary">
                  Planos NEXT
                </p>
                <h2 className="mt-1 text-xl font-black text-foreground">
                  Mais tempo, melhor valor
                </h2>
              </div>
              <p className="hidden text-xs text-muted-foreground md:block">
                Preços definidos para o lançamento
              </p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {NEX_PLANS.map((plan) => (
                <PlanCard key={plan.id} plan={plan} onBuy={handleBuy} />
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function StatusBox({
  title,
  text,
  tone,
}: {
  title: string;
  text: string;
  tone: "warning" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "border-destructive/35 bg-destructive/10"
      : "border-warning/35 bg-warning/10";
  return (
    <div className={`mt-6 rounded-2xl border p-5 ${toneClass}`}>
      <div className="flex items-center gap-2 text-sm font-black text-foreground">
        <ShieldCheck className="h-5 w-5" /> {title}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

function PlanCard({ plan, onBuy }: { plan: NexPlan; onBuy: () => void }) {
  const monthly =
    plan.durationDays >= 30 ? Math.round((plan.priceCents / plan.durationDays) * 30) : null;
  return (
    <button
      type="button"
      onClick={() => void onBuy()}
      className={`relative min-h-40 overflow-hidden rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/55 ${
        plan.featured
          ? "border-primary/45 bg-primary/12 shadow-[0_18px_42px_-30px_rgba(168,85,247,0.95)]"
          : "border-border/70 bg-card/80"
      }`}
    >
      {plan.featured && (
        <span className="absolute right-3 top-3 rounded-full bg-primary px-2 py-1 text-[9px] font-black uppercase tracking-wider text-primary-foreground">
          Melhor valor
        </span>
      )}
      <p className="text-sm font-black text-foreground">{plan.name}</p>
      <p className="mt-4 text-2xl font-black text-foreground">{formatCurrency(plan.priceCents)}</p>
      {monthly && (
        <p className="mt-1 text-xs text-muted-foreground">
          equivale a {formatCurrency(monthly)}/mês
        </p>
      )}
      <span className="mt-5 inline-flex items-center gap-1.5 text-xs font-black text-primary">
        <Check className="h-3.5 w-3.5" /> Ativação por código
      </span>
    </button>
  );
}

function InfoItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-current/10 bg-background/50 p-3">
      <Icon className="h-4 w-4 opacity-70" />
      <p className="mt-2 text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-bold text-foreground">{value}</p>
    </div>
  );
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}
