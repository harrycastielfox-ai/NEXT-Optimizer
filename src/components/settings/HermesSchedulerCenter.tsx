import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bell,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileText,
  Gauge,
  History,
  ListChecks,
  Loader2,
  LockKeyhole,
  Play,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { runBenchmark } from "@/lib/benchmark";
import { loadCleanScanReport, refreshCleanScanReport } from "@/lib/clean";
import { loadDiagnosticReport, refreshDiagnosticReport } from "@/lib/diagnostic";
import { loadPerformanceReport, refreshPerformanceReport } from "@/lib/performance";
import { loadStartupReport, refreshStartupReport } from "@/lib/startup";

type SchedulerTaskType =
  | "benchmark"
  | "diagnostic"
  | "cleanScan"
  | "startupCheck"
  | "performanceCheck"
  | "report";
type SchedulerFrequency = "manual" | "daily" | "weekly" | "monthly" | "onOpen";
type SchedulerStatus = "success" | "prepared" | "skipped" | "failed";

type SchedulerTask = {
  id: string;
  type: SchedulerTaskType;
  frequency: SchedulerFrequency;
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
};

type SchedulerHistoryEntry = {
  id: string;
  startedAt: string;
  taskType: SchedulerTaskType;
  taskTitle: string;
  result: string;
  durationMs: number;
  status: SchedulerStatus;
  notificationPrepared: boolean;
};

type NotificationPreferences = {
  system: boolean;
  cleanupDone: boolean;
  performanceAlerts: boolean;
};

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  system: false,
  cleanupDone: false,
  performanceAlerts: false,
};

const TASKS_KEY = "hermes.scheduler.tasks.v1";
const HISTORY_KEY = "hermes.scheduler.history.v1";
const ADMIN_PREFS_KEY = "hermes.admin.preferences.v1";
const MAX_HISTORY = 30;

const legacyDefaultTaskIds = new Set([
  "scheduler-diagnostic-onOpen",
  "scheduler-cleanScan-weekly",
  "scheduler-startupCheck-weekly",
  "scheduler-performanceCheck-weekly",
  "scheduler-benchmark-manual",
  "scheduler-report-monthly",
]);

const taskOptions: Array<{
  type: SchedulerTaskType;
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    type: "benchmark",
    title: "Benchmark automático",
    description: "Executa benchmark leve permitido.",
    icon: BarChart3,
  },
  {
    type: "diagnostic",
    title: "Diagnóstico automático",
    description: "Lê saúde, CPU, RAM, disco e segurança.",
    icon: ShieldCheck,
  },
  {
    type: "cleanScan",
    title: "Limpeza segura",
    description: "Faz apenas scan de limpeza, sem apagar arquivos.",
    icon: Sparkles,
  },
  {
    type: "startupCheck",
    title: "Verificação de inicialização",
    description: "Lê apps de inicialização, sem desativar.",
    icon: Zap,
  },
  {
    type: "performanceCheck",
    title: "Verificação de desempenho",
    description: "Lê plano de energia e ajustes visuais.",
    icon: Gauge,
  },
  {
    type: "report",
    title: "Geração de relatório",
    description: "Agrupa leituras locais conservadoras.",
    icon: FileText,
  },
];

const visibleTaskTypes = new Set<SchedulerTaskType>(taskOptions.map((option) => option.type));

const frequencyOptions: Array<{ value: SchedulerFrequency; label: string; description: string }> = [
  { value: "manual", label: "Manual", description: "Somente por clique" },
  { value: "daily", label: "Diário", description: "Quando estiver vencido" },
  { value: "weekly", label: "Semanal", description: "A cada 7 dias" },
  { value: "monthly", label: "Mensal", description: "A cada 30 dias" },
  { value: "onOpen", label: "Ao abrir", description: "Uma vez ao dia" },
];

export function HermesSchedulerCenter() {
  const [tasks, setTasks] = useState<SchedulerTask[]>([]);
  const [history, setHistory] = useState<SchedulerHistoryEntry[]>([]);
  const [selectedType, setSelectedType] = useState<SchedulerTaskType>("diagnostic");
  const [selectedFrequency, setSelectedFrequency] = useState<SchedulerFrequency>("weekly");
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [taskPendingRemoval, setTaskPendingRemoval] = useState<SchedulerTask | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );

  useEffect(() => {
    const { tasks: loadedTasks, removedLegacyDefaults } = readTasks();
    const loadedNotifications = readNotificationPreferences();
    setTasks(loadedTasks);
    setHistory(readHistory(removedLegacyDefaults));
    setNotifications(loadedNotifications);

    const onOpenTasks = loadedTasks.filter(
      (task) => task.enabled && task.frequency === "onOpen" && isTaskDue(task),
    );
    if (onOpenTasks.length > 0) {
      void runTaskQueue(onOpenTasks, "Execução ao abrir a central", loadedNotifications);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingTasks = useMemo(
    () => tasks.filter((task) => task.enabled && task.frequency !== "manual" && isTaskDue(task)),
    [tasks],
  );
  const enabledTasks = tasks.filter((task) => task.enabled).length;
  const latestRun = history[0];
  const upcomingTasks = useMemo(() => getUpcomingTasks(tasks), [tasks]);
  const calendarDays = useMemo(() => buildCalendarDays(tasks), [tasks]);
  const nextTask = upcomingTasks[0];

  function addTask() {
    const task = {
      ...defaultTask(selectedType, selectedFrequency, true),
      id: `scheduler-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: new Date().toISOString(),
    };
    commitTasks([task, ...tasks]);
    setNotice("Tarefa adicionada e salva localmente.");
  }

  function removeTask() {
    if (!taskPendingRemoval) return;

    commitTasks(tasks.filter((task) => task.id !== taskPendingRemoval.id));
    setTaskPendingRemoval(null);
    setNotice("Tarefa removida localmente.");
  }

  function updateTask(taskId: string, patch: Partial<SchedulerTask>) {
    commitTasks(tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)));
  }

  function commitTasks(nextTasks: SchedulerTask[]) {
    const normalized = nextTasks.map((task) => ({
      ...task,
      nextRunAt: calculateNextRun(task),
    }));
    saveTasks(normalized);
    setTasks(normalized);
  }

  async function runTaskQueue(
    queue: SchedulerTask[],
    reason: string,
    notificationPreferences = notifications,
  ) {
    if (runningTaskId) {
      return;
    }

    setNotice(`${reason}: ${queue.length} tarefa(s) conservadora(s) em fila.`);
    for (const task of queue) {
      await runTask(task, notificationPreferences);
    }
  }

  async function runTask(task: SchedulerTask, notificationPreferences = notifications) {
    setRunningTaskId(task.id);
    setNotice(null);
    setError(null);
    const startedAt = performance.now();

    try {
      const result = await executeTask(task.type);
      const durationMs = Math.max(1, Math.round(performance.now() - startedAt));
      const entry = buildHistoryEntry(
        task,
        result.message,
        durationMs,
        result.status,
        shouldPrepareNotification(task.type, notificationPreferences),
      );
      commitHistory(entry);
      const updatedTask = {
        ...task,
        lastRunAt: new Date().toISOString(),
      };
      setTasks((current) => {
        const next = current.map((item) => (item.id === task.id ? updatedTask : item));
        const normalized = next.map((item) => ({
          ...item,
          nextRunAt: calculateNextRun(item),
        }));
        saveTasks(normalized);
        return normalized;
      });
      setNotice(result.message);
    } catch (nextError) {
      const durationMs = Math.max(1, Math.round(performance.now() - startedAt));
      const message = errorMessage(nextError);
      const entry = buildHistoryEntry(task, message, durationMs, "failed", false);
      commitHistory(entry);
      setError(message);
    } finally {
      setRunningTaskId(null);
    }
  }

  function commitHistory(entry: SchedulerHistoryEntry) {
    setHistory((current) => {
      const next = [entry, ...current].slice(0, MAX_HISTORY);
      saveHistory(next);
      return next;
    });
  }

  return (
    <section id="manutencao-programada" className="scroll-mt-5 mt-5 space-y-4">
      <div className="overflow-hidden rounded-[28px] border border-border/60 bg-card p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_44px_-28px_rgba(37,99,235,0.28)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <CalendarClock className="h-7 w-7" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold tracking-[0.22em] text-primary">AGENDA NEXT</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
                Manutenção Programada
              </h1>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                Organize verificações locais em uma agenda simples. Sem serviço residente, sem
                monitoramento contínuo e sem ajustes agressivos automáticos.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => runTaskQueue(pendingTasks, "Tarefas vencidas")}
            disabled={pendingTasks.length === 0 || Boolean(runningTaskId)}
            className="inline-flex h-11 w-fit items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-sm font-bold text-primary-foreground shadow-[0_14px_30px_-16px_rgba(37,99,235,0.85)] transition hover:bg-primary/95 disabled:opacity-60"
          >
            {runningTaskId ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Executar pendentes
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <CalendarWeek days={calendarDays} />
          <NextScheduleCard task={nextTask} pendingCount={pendingTasks.length} />
        </div>
      </div>

      {notice && <Notice tone="success" text={notice} />}
      {error && <Notice tone="danger" text={error} />}

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-4">
        <StatusCard
          icon={ListChecks}
          label="TAREFAS"
          value={`${tasks.length}`}
          sub={`${enabledTasks} ativa(s)`}
        />
        <StatusCard
          icon={Clock3}
          label="PENDENTES"
          value={`${pendingTasks.length}`}
          sub="Rodam apenas quando você abre ou executa"
          tone={pendingTasks.length > 0 ? "warning" : "success"}
        />
        <StatusCard
          icon={History}
          label="ÚLTIMA EXECUÇÃO"
          value={latestRun ? statusLabel(latestRun.status) : "Nenhuma"}
          sub={latestRun ? formatDate(latestRun.startedAt) : `Retenção local: ${MAX_HISTORY}`}
        />
        <StatusCard
          icon={Bell}
          label="NOTIFICAÇÕES"
          value={notifications.system ? "Preparadas" : "Desligadas"}
          sub="Integrado às preferências locais"
          tone={notifications.system ? "primary" : "warning"}
        />
      </div>

      <div className="mt-4 space-y-4">
        <section className="rounded-2xl border border-border/70 bg-background/70 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-[12px] font-bold tracking-[0.18em] text-primary">
                NOVA PROGRAMAÇÃO
              </h3>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Escolha uma rotina conservadora e a frequência desejada.
              </p>
            </div>
            <button
              type="button"
              onClick={addTask}
              className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-[0_10px_26px_-14px_rgba(37,99,235,0.85)] transition hover:bg-primary/95"
            >
              <Plus className="h-4 w-4" />
              Agendar
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3">
            <OptionGrid
              label="Tarefa"
              value={selectedType}
              options={taskOptions.map((option) => ({
                value: option.type,
                label: option.title,
                description: option.description,
              }))}
              onChange={setSelectedType}
              wide
            />
            <OptionGrid
              label="Frequência"
              value={selectedFrequency}
              options={frequencyOptions}
              onChange={setSelectedFrequency}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-border/70 bg-background/70 p-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-[12px] font-bold tracking-[0.18em] text-primary">AGENDA ATIVA</h3>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Rotinas salvas localmente, com próxima execução em destaque.
              </p>
            </div>
            <span className="w-fit rounded-full border border-success/20 bg-success/10 px-3 py-1 text-[10px] font-bold text-success">
              Conservador
            </span>
          </div>

          <div className="mt-4 space-y-2">
            {tasks.length > 0 ? (
              tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  running={runningTaskId === task.id}
                  onRun={() => runTask(task)}
                  onRemove={() => setTaskPendingRemoval(task)}
                  onEnabledChange={(enabled) => updateTask(task.id, { enabled })}
                  onFrequencyChange={(frequency) => updateTask(task.id, { frequency })}
                />
              ))
            ) : (
              <EmptyState
                icon={CalendarClock}
                title="Nenhuma tarefa"
                sub="Adicione uma tarefa conservadora para iniciar a manutenção programada."
              />
            )}
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <UpcomingTimeline tasks={upcomingTasks} />

          <section className="rounded-2xl border border-border/70 bg-background/70 p-4">
            <h3 className="text-[12px] font-bold tracking-[0.18em] text-primary">
              HISTÓRICO LOCAL
            </h3>
            <div className="mt-3 space-y-2">
              {history.length > 0 ? (
                history.slice(0, 10).map((entry) => <HistoryRow key={entry.id} entry={entry} />)
              ) : (
                <EmptyState
                  icon={History}
                  title="Sem execuções"
                  sub="Data, tarefa, resultado, duração e status aparecerão aqui."
                />
              )}
            </div>
          </section>
        </div>

        <SafetySummary />
      </div>

      <RemoveTaskDialog
        task={taskPendingRemoval}
        onOpenChange={(open) => {
          if (!open) setTaskPendingRemoval(null);
        }}
        onConfirm={removeTask}
      />
    </section>
  );
}

function RemoveTaskDialog({
  task,
  onOpenChange,
  onConfirm,
}: {
  task: SchedulerTask | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const config = task ? taskConfig(task.type) : null;

  return (
    <AlertDialog open={Boolean(task)} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md overflow-hidden rounded-[28px] border-border/70 bg-card p-0 shadow-[0_30px_90px_-24px_rgba(0,0,0,0.65)]">
        <div className="relative border-b border-border/60 bg-gradient-to-br from-destructive/12 via-card to-card px-6 pb-5 pt-6">
          <div className="pointer-events-none absolute right-0 top-0 h-32 w-32 rounded-full bg-destructive/10 blur-3xl" />
          <AlertDialogHeader className="relative">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-destructive/20 bg-destructive/10 text-destructive">
              <Trash2 className="h-6 w-6" />
            </div>
            <p className="text-[10px] font-bold tracking-[0.2em] text-destructive">
              REMOVER PROGRAMAÇÃO
            </p>
            <AlertDialogTitle className="text-xl font-bold tracking-tight text-foreground">
              Remover esta tarefa?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] leading-relaxed text-muted-foreground">
              A rotina deixará de aparecer na agenda e não será executada novamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
        </div>

        <div className="space-y-3 px-6 py-5">
          <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-background/70 p-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              {config ? <config.icon className="h-5 w-5" /> : <CalendarClock className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-foreground">
                {config?.title ?? "Tarefa programada"}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {task ? frequencyLabel(task.frequency) : "Programação local"}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-2xl border border-success/20 bg-success/10 px-4 py-3">
            <History className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <div>
              <p className="text-[12px] font-bold text-success">Histórico preservado</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                As execuções anteriores e seus resultados continuarão disponíveis no Histórico
                local.
              </p>
            </div>
          </div>
        </div>

        <AlertDialogFooter className="border-t border-border/60 bg-background/40 px-6 py-4 sm:space-x-3">
          <AlertDialogCancel className="h-10 rounded-xl px-4 font-bold">Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="h-10 gap-2 rounded-xl bg-destructive px-4 font-bold text-destructive-foreground hover:bg-destructive/90"
          >
            <Trash2 className="h-4 w-4" />
            Remover tarefa
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CalendarWeek({
  days,
}: {
  days: Array<{
    key: string;
    weekday: string;
    day: string;
    month: string;
    isToday: boolean;
    tasks: SchedulerTask[];
  }>;
}) {
  return (
    <div className="rounded-3xl border border-primary/10 bg-gradient-to-br from-primary/5 via-background to-background p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold tracking-[0.2em] text-primary">SEMANA</p>
          <h3 className="mt-1 text-base font-bold text-foreground">Calendário local</h3>
        </div>
        <span className="rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-[10px] font-bold text-primary">
          Somente sob demanda
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 2xl:grid-cols-7">
        {days.map((day) => (
          <div
            key={day.key}
            className={`min-h-[118px] rounded-2xl border p-3 transition ${
              day.isToday
                ? "border-primary/45 bg-primary/10 shadow-[0_12px_28px_-22px_rgba(37,99,235,0.85)]"
                : "border-border/70 bg-card/80"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  {day.weekday}
                </p>
                <p className="mt-1 text-2xl font-bold leading-none text-foreground">{day.day}</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  {day.month}
                </p>
              </div>
              {day.isToday && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                  Hoje
                </span>
              )}
            </div>

            <div className="mt-3 space-y-1">
              {day.tasks.length > 0 ? (
                day.tasks.slice(0, 2).map((task) => {
                  const config = taskConfig(task.type);
                  return (
                    <div
                      key={task.id}
                      className="truncate rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary"
                    >
                      {config.title}
                    </div>
                  );
                })
              ) : (
                <p className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground">
                  Livre
                </p>
              )}
              {day.tasks.length > 2 && (
                <p className="text-[10px] font-bold text-primary">
                  +{day.tasks.length - 2} rotina(s)
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NextScheduleCard({ task, pendingCount }: { task?: SchedulerTask; pendingCount: number }) {
  const config = task ? taskConfig(task.type) : null;
  const Icon = config?.icon ?? CalendarClock;

  return (
    <div className="rounded-3xl border border-border/70 bg-background/80 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-[0.18em] text-primary">PRÓXIMA ROTINA</p>
          <h3 className="mt-1 text-lg font-bold leading-tight text-foreground">
            {config ? config.title : "Nada agendado"}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {task?.nextRunAt
              ? formatDate(task.nextRunAt)
              : "Adicione uma rotina para aparecer no calendário."}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-border/70 bg-card px-3 py-3">
          <p className="text-[10px] font-bold tracking-[0.16em] text-muted-foreground">PENDENTES</p>
          <p className="mt-1 text-xl font-bold text-foreground">{pendingCount}</p>
        </div>
        <div className="rounded-2xl border border-border/70 bg-card px-3 py-3">
          <p className="text-[10px] font-bold tracking-[0.16em] text-muted-foreground">MODO</p>
          <p className="mt-1 text-xl font-bold text-foreground">Local</p>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-2xl border border-primary/15 bg-primary/5 px-3 py-3 text-[12px] font-semibold leading-relaxed text-primary">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          O NEXT não fica rodando em segundo plano. A agenda é verificada ao abrir ou por clique.
        </span>
      </div>
    </div>
  );
}

function UpcomingTimeline({ tasks }: { tasks: SchedulerTask[] }) {
  return (
    <section className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <h3 className="text-[12px] font-bold tracking-[0.18em] text-primary">PRÓXIMAS EXECUÇÕES</h3>
      <div className="mt-3 space-y-2">
        {tasks.length > 0 ? (
          tasks.slice(0, 5).map((task) => {
            const config = taskConfig(task.type);
            const Icon = config.icon;
            return (
              <div
                key={task.id}
                className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card px-3 py-3"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-foreground">{config.title}</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    {task.nextRunAt ? formatDate(task.nextRunAt) : "Manual"}
                  </p>
                </div>
                <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-bold text-muted-foreground">
                  {frequencyLabel(task.frequency)}
                </span>
              </div>
            );
          })
        ) : (
          <EmptyState
            icon={CalendarClock}
            title="Agenda livre"
            sub="As próximas execuções aparecerão aqui."
          />
        )}
      </div>
    </section>
  );
}

function SafetySummary() {
  const items = [
    "Sem serviço residente",
    "Sem limpeza automática real",
    "Sem Registro automático",
    "Sem comandos de reparo",
  ];

  return (
    <section className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <h3 className="text-[12px] font-bold tracking-[0.18em] text-primary">SEGURANÇA DA AGENDA</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
        A manutenção programada é conservadora: prepara leituras, scans e relatórios locais, sem
        mexer no Windows por conta própria.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2">
        {items.map((item) => (
          <div
            key={item}
            className="flex items-center gap-2 rounded-xl border border-success/20 bg-success/10 px-3 py-2 text-[12px] font-bold text-success"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

async function executeTask(
  type: SchedulerTaskType,
): Promise<{ status: SchedulerStatus; message: string }> {
  if (type === "benchmark") {
    const report = await runBenchmark();
    return {
      status: "success",
      message: `Benchmark concluído: score ${report.score}/100. ${report.verdict}`,
    };
  }

  if (type === "diagnostic") {
    const report = await refreshDiagnosticReport();
    return {
      status: "success",
      message: `Diagnóstico concluído: ${report.healthLabel}, score ${Math.round(report.healthScore)}/100.`,
    };
  }

  if (type === "cleanScan") {
    const report = await refreshCleanScanReport();
    return {
      status: "success",
      message: `Clean Scan concluído: ${formatGb(report.totalGb)} GB candidatos. Nada foi apagado.`,
    };
  }

  if (type === "startupCheck") {
    const report = await refreshStartupReport();
    return {
      status: "success",
      message: `Inicialização verificada: ${report.totalItems} item(ns), ${report.highImpactCount} alto impacto.`,
    };
  }

  if (type === "performanceCheck") {
    const report = await refreshPerformanceReport();
    return {
      status: "success",
      message: `Desempenho verificado: plano ${report.powerPlan.activeSchemeName}, Game Mode ${report.gameMode.status}.`,
    };
  }

  const [diagnostic, clean, startup, performance] = await Promise.all([
    loadDiagnosticReport(),
    loadCleanScanReport(),
    loadStartupReport(),
    loadPerformanceReport(),
  ]);

  return {
    status: "success",
    message: `Relatório gerado: score ${Math.round(diagnostic.healthScore)}/100, ${formatGb(clean.totalGb)} GB limpeza, ${startup.totalItems} startup, plano ${performance.powerPlan.activeSchemeName}.`,
  };
}

function TaskRow({
  task,
  running,
  onRun,
  onRemove,
  onEnabledChange,
  onFrequencyChange,
}: {
  task: SchedulerTask;
  running: boolean;
  onRun: () => void;
  onRemove: () => void;
  onEnabledChange: (enabled: boolean) => void;
  onFrequencyChange: (frequency: SchedulerFrequency) => void;
}) {
  const config = taskConfig(task.type);
  const Icon = config.icon;
  const due = task.enabled && task.frequency !== "manual" && isTaskDue(task);
  const dateBadge = getTaskDateBadge(task);

  return (
    <div
      className={`rounded-2xl border px-3 py-3 transition ${due ? "border-primary/35 bg-primary/5" : "border-border/70 bg-card"}`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={`flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-2xl border text-center ${due ? "border-primary/35 bg-primary/10 text-primary" : "border-border/70 bg-background text-foreground"}`}
          >
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              {dateBadge.top}
            </span>
            <span className="text-xl font-bold leading-none">{dateBadge.main}</span>
            <span className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              {dateBadge.bottom}
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <p className="text-sm font-bold text-foreground">{config.title}</p>
              {due && (
                <span className="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-[10px] font-bold text-warning">
                  Pendente
                </span>
              )}
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {config.description}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-bold text-muted-foreground">
                {frequencyLabel(task.frequency)}
              </span>
              <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary">
                {task.nextRunAt ? `Próxima: ${formatDate(task.nextRunAt)}` : "Execução manual"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Switch
            checked={task.enabled}
            onCheckedChange={onEnabledChange}
            aria-label={`Ativar ${config.title}`}
          />
          <button
            type="button"
            onClick={onRun}
            disabled={running || !task.enabled}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground transition hover:bg-primary/95 disabled:opacity-60"
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Executar
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground transition hover:bg-muted"
            aria-label={`Remover ${config.title}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3">
        <OptionGrid
          label="Frequência"
          value={task.frequency}
          options={frequencyOptions}
          onChange={onFrequencyChange}
          compact
        />
      </div>
    </div>
  );
}

function OptionGrid<T extends string>({
  label,
  value,
  options,
  onChange,
  compact,
  wide,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; description: string }>;
  onChange: (value: T) => void;
  compact?: boolean;
  wide?: boolean;
}) {
  const gridClass = compact
    ? "sm:grid-cols-5"
    : wide
      ? "md:grid-cols-3 xl:grid-cols-6"
      : "md:grid-cols-2 xl:grid-cols-5";

  return (
    <div className="rounded-xl border border-border/70 bg-card px-3 py-3">
      <p className="text-[11px] font-bold tracking-[0.16em] text-primary">{label}</p>
      <div className={`mt-3 grid grid-cols-1 gap-2 ${gridClass}`}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`min-h-14 rounded-xl border px-3 py-2 text-left transition ${
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/70 bg-background/70 text-foreground hover:border-primary/35"
              }`}
            >
              <span className="block text-sm font-bold">{option.label}</span>
              {!compact && (
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {option.description}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StatusCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "primary",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
  tone?: "primary" | "success" | "warning" | "danger";
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${toneClass(tone)}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-wider text-muted-foreground">{label}</p>
          <p className="text-lg font-bold leading-tight text-foreground">{value}</p>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{sub}</p>
    </div>
  );
}

function HistoryRow({ entry }: { entry: SchedulerHistoryEntry }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">{entry.taskTitle}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{entry.result}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <span>{formatDate(entry.startedAt)}</span>
            <span>{entry.durationMs} ms</span>
            {entry.notificationPrepared && <span>Notificação preparada</span>}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusPillClass(entry.status)}`}
        >
          {statusLabel(entry.status)}
        </span>
      </div>
    </div>
  );
}

function Notice({ tone, text }: { tone: "success" | "danger"; text: string }) {
  return (
    <div
      className={`mt-4 rounded-xl border px-4 py-3 text-sm font-semibold ${tone === "success" ? "border-success/20 bg-success/10 text-success" : "border-destructive/20 bg-destructive/10 text-destructive"}`}
    >
      {text}
    </div>
  );
}

function EmptyState({ icon: Icon, title, sub }: { icon: LucideIcon; title: string; sub: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/70 px-4 py-5 text-center">
      <Icon className="mx-auto h-6 w-6 text-muted-foreground" />
      <p className="mt-2 text-sm font-bold text-foreground">{title}</p>
      <p className="mt-1 text-[12px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function defaultTask(
  type: SchedulerTaskType,
  frequency: SchedulerFrequency,
  enabled: boolean,
): SchedulerTask {
  const task = {
    id: `scheduler-${type}-${frequency}`,
    type,
    frequency,
    enabled,
    createdAt: new Date().toISOString(),
  };

  return {
    ...task,
    nextRunAt: calculateNextRun(task),
  };
}

function taskConfig(type: SchedulerTaskType) {
  return taskOptions.find((option) => option.type === type) ?? taskOptions[0];
}

function getUpcomingTasks(tasks: SchedulerTask[]) {
  return tasks
    .filter((task) => task.enabled && task.nextRunAt)
    .sort((a, b) => new Date(a.nextRunAt ?? 0).getTime() - new Date(b.nextRunAt ?? 0).getTime())
    .slice(0, 8);
}

function buildCalendarDays(tasks: SchedulerTask[]) {
  const today = startOfDay(new Date());

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    const nextDay = new Date(date);
    nextDay.setDate(date.getDate() + 1);
    const dayTasks = tasks.filter((task) => {
      if (!task.enabled || !task.nextRunAt) {
        return false;
      }
      const nextRun = new Date(task.nextRunAt);
      return nextRun >= date && nextRun < nextDay;
    });

    return {
      key: date.toISOString(),
      weekday: new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(date).replace(".", ""),
      day: new Intl.DateTimeFormat("pt-BR", { day: "2-digit" }).format(date),
      month: new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(date).replace(".", ""),
      isToday: index === 0,
      tasks: dayTasks,
    };
  });
}

function getTaskDateBadge(task: SchedulerTask) {
  if (!task.nextRunAt) {
    return { top: "Modo", main: "M", bottom: "Manual" };
  }

  const date = new Date(task.nextRunAt);
  if (Number.isNaN(date.getTime())) {
    return { top: "Data", main: "--", bottom: "Local" };
  }

  return {
    top: new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(date).replace(".", ""),
    main: new Intl.DateTimeFormat("pt-BR", { day: "2-digit" }).format(date),
    bottom: new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(date).replace(".", ""),
  };
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function frequencyLabel(value: SchedulerFrequency) {
  return frequencyOptions.find((option) => option.value === value)?.label ?? value;
}

function calculateNextRun(task: Pick<SchedulerTask, "frequency" | "lastRunAt">) {
  if (task.frequency === "manual") {
    return undefined;
  }

  const base = task.lastRunAt ? new Date(task.lastRunAt) : new Date();
  const next = new Date(base);

  if (task.frequency === "onOpen") {
    next.setDate(next.getDate() + 1);
  } else if (task.frequency === "daily") {
    next.setDate(next.getDate() + 1);
  } else if (task.frequency === "weekly") {
    next.setDate(next.getDate() + 7);
  } else {
    next.setDate(next.getDate() + 30);
  }

  return next.toISOString();
}

function isTaskDue(task: SchedulerTask) {
  if (!task.enabled || task.frequency === "manual") {
    return false;
  }

  if (!task.lastRunAt) {
    return task.frequency === "onOpen";
  }

  const nextRun = task.nextRunAt
    ? new Date(task.nextRunAt)
    : new Date(calculateNextRun(task) ?? Date.now());
  return Date.now() >= nextRun.getTime();
}

function buildHistoryEntry(
  task: SchedulerTask,
  result: string,
  durationMs: number,
  status: SchedulerStatus,
  notificationPrepared: boolean,
): SchedulerHistoryEntry {
  return {
    id: `scheduler-history-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    startedAt: new Date().toISOString(),
    taskType: task.type,
    taskTitle: taskConfig(task.type).title,
    result,
    durationMs,
    status,
    notificationPrepared,
  };
}

function readTasks(): { tasks: SchedulerTask[]; removedLegacyDefaults: boolean } {
  if (typeof window === "undefined") {
    return { tasks: [], removedLegacyDefaults: false };
  }

  try {
    const raw = window.localStorage.getItem(TASKS_KEY);
    if (!raw) {
      return { tasks: [], removedLegacyDefaults: false };
    }

    const parsed = JSON.parse(raw) as SchedulerTask[];
    if (!Array.isArray(parsed)) {
      saveTasks([]);
      return { tasks: [], removedLegacyDefaults: false };
    }

    const visibleTasks = parsed.filter((task) => visibleTaskTypes.has(task.type));
    const migratedTasks = visibleTasks.filter((task) => !legacyDefaultTaskIds.has(task.id));
    const removedLegacyDefaults = migratedTasks.length !== visibleTasks.length;
    const normalizedTasks = migratedTasks.map((task) => ({
      ...task,
      nextRunAt: calculateNextRun(task),
    }));

    if (removedLegacyDefaults || normalizedTasks.length !== parsed.length) {
      saveTasks(normalizedTasks);
    }

    return { tasks: normalizedTasks, removedLegacyDefaults };
  } catch (error) {
    console.warn("Falha ao ler tarefas programadas NEXT.", error);
    saveTasks([]);
    return { tasks: [], removedLegacyDefaults: false };
  }
}

function saveTasks(tasks: SchedulerTask[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

function readHistory(clearLegacyHistory = false): SchedulerHistoryEntry[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    if (clearLegacyHistory) {
      saveHistory([]);
      return [];
    }

    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as SchedulerHistoryEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) : [];
  } catch (error) {
    console.warn("Falha ao ler histórico do Scheduler NEXT.", error);
    return [];
  }
}

function saveHistory(history: SchedulerHistoryEntry[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

function readNotificationPreferences(): NotificationPreferences {
  if (typeof window === "undefined") {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }

  try {
    const raw = window.localStorage.getItem(ADMIN_PREFS_KEY);
    if (!raw) {
      return DEFAULT_NOTIFICATION_PREFERENCES;
    }

    const parsed = JSON.parse(raw) as { notifications: Partial<NotificationPreferences> };
    return {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...parsed.notifications,
    };
  } catch (error) {
    console.warn("Falha ao ler preferências de notificação NEXT.", error);
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
}

function shouldPrepareNotification(
  type: SchedulerTaskType,
  notifications: NotificationPreferences,
) {
  if (!notifications.system) {
    return false;
  }

  if (type === "report") return notifications.system;
  if (type === "cleanScan") return notifications.cleanupDone;
  if (type === "benchmark") return notifications.performanceAlerts;
  if (type === "performanceCheck") return notifications.performanceAlerts;
  return true;
}

function statusPillClass(status: SchedulerStatus) {
  if (status === "success") return "border-success/20 bg-success/10 text-success";
  if (status === "prepared") return "border-primary/20 bg-primary/10 text-primary";
  if (status === "skipped") return "border-warning/25 bg-warning/10 text-warning";
  return "border-destructive/20 bg-destructive/10 text-destructive";
}

function statusLabel(status: SchedulerStatus) {
  if (status === "success") return "Concluído";
  if (status === "prepared") return "Preparado";
  if (status === "skipped") return "Pulado";
  return "Falha";
}

function toneClass(tone: "primary" | "success" | "warning" | "danger") {
  if (tone === "success") return "bg-success/10 text-success";
  if (tone === "warning") return "bg-warning/10 text-warning";
  if (tone === "danger") return "bg-destructive/10 text-destructive";
  return "bg-primary-soft text-primary";
}

function formatGb(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Indisponível";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
