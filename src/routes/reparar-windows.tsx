import { createFileRoute } from "@tanstack/react-router";
import { SafeTestModeNotice } from "@/components/common/SafeTestModeNotice";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { HermesRepairCenter } from "@/components/settings/HermesRepairCenter";

export const Route = createFileRoute("/reparar-windows")({
  head: () => ({
    meta: [
      { title: "NEXT Optimizer - Reparar Windows" },
      { name: "description", content: "Centro de reparo do Windows no NEXT Optimizer." },
    ],
  }),
  component: RepararWindowsPage,
});

function RepararWindowsPage() {
  return (
    <div className="lightning-bg min-h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 overflow-auto px-5 pt-6 pb-4 xl:px-8 xl:pt-7">
          <div className="mb-5">
            <p className="mb-2 text-xs font-bold tracking-[0.22em] text-primary">REPARAR WINDOWS</p>
            <h1 className="text-[clamp(28px,2.4vw,38px)] font-bold leading-tight tracking-tight text-foreground">
              Reparar Windows
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Verificações de integridade, imagem do sistema e histórico de reparos. Nenhum reparo
              pesado roda automaticamente.
            </p>
          </div>

          <SafeTestModeNotice />

          <HermesRepairCenter />
        </main>
      </div>
    </div>
  );
}
