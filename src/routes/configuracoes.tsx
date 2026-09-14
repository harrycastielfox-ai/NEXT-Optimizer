import { createFileRoute } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { MonitorCog } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { SafeTestModeNotice } from "@/components/common/SafeTestModeNotice";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { useHermesTranslation } from "@/lib/preferences";

const HermesAdminSettings = lazy(() =>
  import("@/components/settings/HermesAdminSettings").then((module) => ({
    default: module.HermesAdminSettings,
  })),
);

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "NEXT Optimizer - Configurações" },
      { name: "description", content: "Preferencias locais do NEXT Optimizer." },
    ],
  }),
  component: ConfiguracoesPage,
});

function ConfiguracoesPage() {
  const { t } = useHermesTranslation();

  return (
    <div className="lightning-bg min-h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 px-5 pt-6 pb-4 overflow-auto xl:px-8 xl:pt-7">
          <div className="mb-5">
            <p className="text-xs font-bold tracking-[0.22em] text-primary mb-2">
              {t("settings.eyebrow")}
            </p>
            <h1 className="text-[clamp(26px,2vw,32px)] leading-tight font-bold tracking-tight text-foreground">
              {t("settings.title")}
            </h1>
            <p className="text-[13px] text-muted-foreground mt-1">{t("settings.subtitle")}</p>
          </div>

          <SafeTestModeNotice />

          <DeferredSettingsSection
            id="configuracoes-completas"
            icon={MonitorCog}
            title={t("settings.admin.title")}
            description={t("settings.admin.description")}
          >
            <HermesAdminSettings />
          </DeferredSettingsSection>
        </main>
      </div>
    </div>
  );
}

function DeferredSettingsSection({
  id,
  icon: Icon,
  title,
  description,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [shouldMount, setShouldMount] = useState(false);

  useEffect(() => {
    if (shouldMount) {
      return;
    }

    const node = sectionRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      const timer = window.setTimeout(() => setShouldMount(true), 250);
      return () => window.clearTimeout(timer);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldMount(true);
          observer.disconnect();
        }
      },
      { rootMargin: "420px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldMount]);

  return (
    <section id={shouldMount ? undefined : id} ref={sectionRef} className="scroll-mt-5">
      {shouldMount ? (
        <Suspense
          fallback={
            <SettingsSectionPlaceholder
              icon={Icon}
              title={title}
              description={description}
              loading
            />
          }
        >
          {children}
        </Suspense>
      ) : (
        <SettingsSectionPlaceholder icon={Icon} title={title} description={description} />
      )}
    </section>
  );
}

function SettingsSectionPlaceholder({
  icon: Icon,
  title,
  description,
  loading,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  loading?: boolean;
}) {
  const { t } = useHermesTranslation();

  return (
    <div className="mt-5 rounded-2xl border border-border/60 bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_34px_-20px_rgba(15,23,42,0.16)]">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-foreground">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
          <p className="mt-3 text-[12px] font-semibold text-primary">
            {loading ? t("settings.placeholder.loading") : t("settings.placeholder.waiting")}
          </p>
        </div>
      </div>
    </div>
  );
}
