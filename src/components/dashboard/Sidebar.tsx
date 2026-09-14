import {
  CalendarClock,
  Home,
  LockKeyhole,
  Settings,
  ShieldCheck,
  UserRound,
  Zap,
} from "lucide-react";
import { Link, useLocation } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { useHermesTranslation } from "@/lib/preferences";

const items = [
  { icon: Home, labelKey: "sidebar.dashboard", to: "/" },
  { icon: Zap, labelKey: "sidebar.optimize", to: "/otimizar" },
  { icon: LockKeyhole, labelKey: "sidebar.antiCheat", to: "/anti-cheat" },
  { icon: ShieldCheck, labelKey: "sidebar.defender", to: "/defender" },
  { icon: CalendarClock, labelKey: "sidebar.scheduler", to: "/manutencao-programada" },
  { icon: UserRound, labelKey: "sidebar.account", to: "/conta" },
  { icon: Settings, labelKey: "sidebar.settings", to: "/configuracoes" },
] as const;

export function Sidebar() {
  const { pathname } = useLocation();
  const { t } = useHermesTranslation();
  const handleMinimize = useCallback(async () => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return;
    }

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("hermes_window_minimize");
    } catch (commandError) {
      console.warn(
        "Comando nativo de minimizar indisponível, tentando API de janela.",
        commandError,
      );
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().minimize();
      } catch (error) {
        console.warn("Não foi possível minimizar a janela do NEXT.", error);
      }
    }
  }, []);

  return (
    <aside className="sidebar-texture sticky top-0 h-screen w-[230px] 2xl:w-[260px] shrink-0 overflow-hidden flex flex-col px-4 py-5 2xl:px-5 2xl:py-6 border-r border-slate-200/80 dark:border-white/10">
      <button
        type="button"
        aria-label="Minimizar NEXT Optimizer"
        title="Minimizar"
        onClick={handleMinimize}
        className="relative z-10 mb-7 flex shrink-0 flex-col items-center justify-center rounded-3xl px-3 py-5 outline-none transition-transform duration-200 hover:scale-[1.015] focus-visible:ring-2 focus-visible:ring-primary/70"
      >
        <span className="text-[44px] font-black leading-none tracking-[0.08em] text-transparent bg-clip-text bg-gradient-to-r from-white via-fuchsia-100 to-primary drop-shadow-[0_0_24px_rgba(168,85,247,0.45)]">
          NEXT
        </span>
        <span className="mt-2 text-[10px] font-bold uppercase tracking-[0.28em] text-primary/90">
          Optimizer
        </span>
        <span className="mt-2 h-px w-28 bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
      </button>

      <nav className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 flex flex-col gap-1 2xl:gap-1.5 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
        {items.map(({ icon: Icon, labelKey, to }) => {
          const isActive = pathname === to;
          const label = t(labelKey);
          return (
            <Link
              key={label}
              to={to}
              className={`group flex items-center gap-3 px-3.5 py-2.5 2xl:px-4 2xl:py-3 rounded-2xl text-sm font-semibold transition-all duration-200 ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-[0_16px_36px_-22px_rgba(168,85,247,0.95)] ring-1 ring-white/25"
                  : "text-slate-700 hover:bg-white/[0.72] hover:text-slate-950 hover:shadow-[0_10px_24px_-20px_rgba(15,23,42,0.45)] dark:text-slate-200 dark:hover:bg-white/[0.08] dark:hover:text-white"
              }`}
            >
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl transition-all duration-200 ${
                  isActive
                    ? "bg-white/[0.16] text-white"
                    : "bg-slate-900/[0.04] text-slate-500 group-hover:bg-primary/10 group-hover:text-primary dark:bg-white/[0.08] dark:text-slate-300 dark:group-hover:bg-primary/18 dark:group-hover:text-primary"
                }`}
              >
                <Icon className="w-[18px] h-[18px]" strokeWidth={isActive ? 2.4 : 2} />
              </span>
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
