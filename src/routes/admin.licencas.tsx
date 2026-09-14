import { createFileRoute } from "@tanstack/react-router";
import {
  BadgeCheck,
  Ban,
  Check,
  Clipboard,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { invokeNexLicenseAdmin, NEX_PLANS, type NexPlan } from "@/lib/nex-auth";

export const Route = createFileRoute("/admin/licencas")({
  head: () => ({
    meta: [
      { title: "NEXT - Administração de licenças" },
      {
        name: "description",
        content: "Operações administrativas protegidas do licenciamento NEXT.",
      },
    ],
  }),
  component: NexLicenseAdminPage,
});

type CreatedCode = {
  code_id: string;
  plain_code: string;
  plan_id: string;
  plan_name: string;
  expires_at: string | null;
};

type TransferRequest = {
  id: string;
  user_id: string;
  requested_device_label: string;
  status: "pending" | "approved" | "rejected" | "expired";
  requested_at: string;
  reviewed_at: string | null;
  review_note: string | null;
};

const ADMIN_KEY_SESSION_KEY = "nex.admin.key.session.v1";

function NexLicenseAdminPage() {
  const [adminKey, setAdminKey] = useState("");
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [planId, setPlanId] = useState(NEX_PLANS[1].id);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [codeLifetimeDays, setCodeLifetimeDays] = useState("30");
  const [createdCode, setCreatedCode] = useState<CreatedCode | null>(null);
  const [transfers, setTransfers] = useState<TransferRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selectedPlan = useMemo(
    () => NEX_PLANS.find((plan) => plan.id === planId) ?? NEX_PLANS[1],
    [planId],
  );

  const loadTransfers = useCallback(
    async (keyOverride?: string) => {
      const key = (keyOverride ?? adminKey).trim();
      if (!key) return;
      setBusy("load");
      setMessage(null);
      try {
        const result = await invokeNexLicenseAdmin<{ transfers: TransferRequest[] }>(
          { action: "list_transfers" },
          key,
        );
        setTransfers(result.transfers);
        setAdminUnlocked(true);
      } catch (error) {
        setAdminUnlocked(false);
        window.sessionStorage.removeItem(ADMIN_KEY_SESSION_KEY);
        setMessage(adminError(error));
      } finally {
        setBusy(null);
      }
    },
    [adminKey],
  );

  useEffect(() => {
    window.sessionStorage.removeItem(ADMIN_KEY_SESSION_KEY);
  }, []);

  async function handleUnlock(event: FormEvent) {
    event.preventDefault();
    await loadTransfers(adminKey);
  }

  function handleLock() {
    setAdminUnlocked(false);
    setAdminKey("");
    setTransfers([]);
    setCreatedCode(null);
    window.sessionStorage.removeItem(ADMIN_KEY_SESSION_KEY);
  }

  async function handleCreateCode(event: FormEvent) {
    event.preventDefault();
    setBusy("create");
    setMessage(null);
    setCreatedCode(null);

    try {
      const lifetime = Number(codeLifetimeDays);
      const expiresAt =
        Number.isFinite(lifetime) && lifetime > 0
          ? new Date(Date.now() + lifetime * 86_400_000).toISOString()
          : null;
      const result = await invokeNexLicenseAdmin<{ code: CreatedCode }>(
        {
          action: "create_code",
          planId,
          assignedEmail: email.trim(),
          expiresAt,
          note: note.trim() || null,
        },
        adminKey,
      );
      setCreatedCode(result.code);
      setMessage("Código criado. Ele será exibido somente nesta resposta.");
    } catch (error) {
      setMessage(adminError(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleReview(transfer: TransferRequest, decision: "approved" | "rejected") {
    setBusy(transfer.id);
    setMessage(null);
    try {
      await invokeNexLicenseAdmin(
        {
          action: "review_transfer",
          transferId: transfer.id,
          decision,
          note:
            decision === "approved"
              ? "Troca aprovada pelo painel NEXT."
              : "Troca rejeitada pelo painel NEXT.",
        },
        adminKey,
      );
      await loadTransfers();
      setMessage(decision === "approved" ? "Troca aprovada." : "Troca rejeitada.");
    } catch (error) {
      setMessage(adminError(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleCopyCode() {
    if (!createdCode) return;
    await navigator.clipboard.writeText(createdCode.plain_code);
    setMessage("Código copiado.");
  }

  return (
    <div className="lightning-bg flex min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-auto px-5 py-6 xl:px-8 xl:py-7">
        <div className="mx-auto w-full max-w-[1220px]">
          <header className="border-b border-border/60 pb-5">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-primary">
              NEXT CONTROL
            </p>
            <h1 className="mt-2 text-3xl font-black text-foreground">Administração de licenças</h1>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Gere códigos vinculados ao comprador. O histórico abaixo contém apenas trocas do fluxo
              antigo. O acesso é validado no servidor em cada operação.
            </p>
          </header>

          {message && (
            <div className="mt-5 border-l-2 border-primary bg-primary/10 px-4 py-3 text-sm font-semibold text-foreground">
              {message}
            </div>
          )}

          {!adminUnlocked ? (
            <section className="mt-6 border border-border/70 bg-card/60 p-6">
              <LockKeyhole className="h-8 w-8 text-primary" />
              <h2 className="mt-4 text-xl font-black text-foreground">Acesso administrativo</h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Digite a chave administrativa local. Ela é enviada somente para a Edge Function,
                validada por hash no Supabase e mantida apenas nesta sessão.
              </p>
              <form
                onSubmit={handleUnlock}
                className="mt-5 flex max-w-2xl flex-col gap-3 sm:flex-row"
              >
                <input
                  required
                  type="password"
                  value={adminKey}
                  onChange={(event) => setAdminKey(event.target.value)}
                  placeholder="NEX-ADMIN-..."
                  className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background/75 px-3 text-sm text-foreground outline-none focus:border-primary"
                />
                <button
                  type="submit"
                  disabled={busy !== null}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-black text-primary-foreground disabled:opacity-50"
                >
                  {busy === "load" ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  Validar acesso
                </button>
              </form>
            </section>
          ) : (
            <>
              <div className="mt-6 flex items-center justify-between gap-4 border border-emerald-500/25 bg-emerald-500/10 p-4">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="h-5 w-5 text-emerald-300" />
                  <p className="text-sm font-bold text-emerald-100">
                    Painel administrativo liberado nesta sessão.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleLock}
                  className="rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-black text-emerald-200"
                >
                  Bloquear painel
                </button>
              </div>

              <div className="mt-6 grid gap-7 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <section>
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
                      <KeyRound className="h-5 w-5" />
                    </span>
                    <div>
                      <h2 className="text-lg font-black text-foreground">Novo código</h2>
                      <p className="text-sm text-muted-foreground">
                        Uso único e limitado ao e-mail informado.
                      </p>
                    </div>
                  </div>

                  <form onSubmit={handleCreateCode} className="mt-5 space-y-4">
                    <Field label="E-mail do comprador">
                      <input
                        required
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="cliente@email.com"
                        className="h-11 w-full rounded-xl border border-border bg-background/75 px-3 text-sm text-foreground outline-none focus:border-primary"
                      />
                    </Field>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Plano">
                        <select
                          value={planId}
                          onChange={(event) => setPlanId(event.target.value)}
                          className="h-11 w-full rounded-xl border border-border bg-background/75 px-3 text-sm font-bold text-foreground outline-none focus:border-primary"
                        >
                          {NEX_PLANS.map((plan: NexPlan) => (
                            <option key={plan.id} value={plan.id}>
                              {plan.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Prazo para resgatar">
                        <select
                          value={codeLifetimeDays}
                          onChange={(event) => setCodeLifetimeDays(event.target.value)}
                          className="h-11 w-full rounded-xl border border-border bg-background/75 px-3 text-sm font-bold text-foreground outline-none focus:border-primary"
                        >
                          <option value="7">7 dias</option>
                          <option value="15">15 dias</option>
                          <option value="30">30 dias</option>
                          <option value="90">90 dias</option>
                          <option value="0">Sem prazo</option>
                        </select>
                      </Field>
                    </div>

                    <Field label="Referência interna">
                      <input
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder="Pedido, cliente ou observação"
                        maxLength={500}
                        className="h-11 w-full rounded-xl border border-border bg-background/75 px-3 text-sm text-foreground outline-none focus:border-primary"
                      />
                    </Field>

                    <button
                      type="submit"
                      disabled={busy !== null}
                      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-black text-primary-foreground disabled:opacity-50"
                    >
                      {busy === "create" ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <KeyRound className="h-4 w-4" />
                      )}
                      Gerar código de {selectedPlan.name}
                    </button>
                  </form>

                  {createdCode && (
                    <div className="mt-5 border border-emerald-500/35 bg-emerald-500/10 p-4">
                      <div className="flex items-center gap-2 text-emerald-400">
                        <BadgeCheck className="h-5 w-5" />
                        <p className="font-black">Código gerado</p>
                      </div>
                      <p className="mt-3 break-all font-mono text-lg font-black text-foreground">
                        {createdCode.plain_code}
                      </p>
                      <button
                        type="button"
                        onClick={() => void handleCopyCode()}
                        className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-500/30 px-3 text-xs font-black text-emerald-300"
                      >
                        <Clipboard className="h-4 w-4" /> Copiar código
                      </button>
                    </div>
                  )}
                </section>

                <section>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-black text-foreground">Trocas do fluxo antigo</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        As licenças atuais por e-mail usam o atendimento manual documentado.
                      </p>
                    </div>
                    <button
                      type="button"
                      title="Atualizar solicitações"
                      onClick={() => void loadTransfers()}
                      disabled={busy !== null}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border text-primary disabled:opacity-50"
                    >
                      <RefreshCw className={`h-4 w-4 ${busy === "load" ? "animate-spin" : ""}`} />
                    </button>
                  </div>

                  <div className="mt-5 divide-y divide-border/60 border-y border-border/60">
                    {transfers.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        Nenhuma solicitação encontrada.
                      </p>
                    ) : (
                      transfers.map((transfer) => (
                        <article key={transfer.id} className="py-4">
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-black text-foreground">
                                  {transfer.requested_device_label}
                                </p>
                                <StatusBadge status={transfer.status} />
                              </div>
                              <p className="mt-1 truncate text-xs text-muted-foreground">
                                Conta: {transfer.user_id}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Solicitado em {formatDateTime(transfer.requested_at)}
                              </p>
                            </div>

                            {transfer.status === "pending" && (
                              <div className="flex shrink-0 gap-2">
                                <button
                                  type="button"
                                  title="Rejeitar troca"
                                  onClick={() => void handleReview(transfer, "rejected")}
                                  disabled={busy !== null}
                                  className="grid h-10 w-10 place-items-center rounded-xl border border-red-500/35 text-red-400 disabled:opacity-50"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleReview(transfer, "approved")}
                                  disabled={busy !== null}
                                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-black text-slate-950 disabled:opacity-50"
                                >
                                  {busy === transfer.id ? (
                                    <LoaderCircle className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Check className="h-4 w-4" />
                                  )}
                                  Aprovar
                                </button>
                              </div>
                            )}
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </section>
              </div>

              <div className="mt-7 flex items-start gap-3 border-t border-border/60 pt-5 text-xs text-muted-foreground">
                <Ban className="mt-0.5 h-4 w-4 shrink-0 text-primary" />A chave administrativa fica
                apenas na sessão desta janela e o banco armazena somente o hash.
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function StatusBadge({ status }: { status: TransferRequest["status"] }) {
  const labels = {
    pending: "Pendente",
    approved: "Aprovada",
    rejected: "Rejeitada",
    expired: "Expirada",
  };
  return (
    <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-primary">
      {labels[status]}
    </span>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function adminError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/ADMIN_KEY_REQUIRED/i.test(message)) return "Informe a chave administrativa.";
  if (/ADMIN_NOT_ALLOWED/i.test(message)) return "Chave administrativa inválida ou desativada.";
  if (/INVALID_ASSIGNED_EMAIL/i.test(message)) return "Informe um e-mail válido.";
  if (/INVALID_PLAN/i.test(message)) return "O plano selecionado não está disponível.";
  if (/TRANSFER_NOT_PENDING/i.test(message)) {
    return "Esta solicitação já foi analisada ou cancelada.";
  }
  return message;
}
