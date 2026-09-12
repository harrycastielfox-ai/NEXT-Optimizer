import { createFileRoute } from "@tanstack/react-router";
import { SafeTestModeNotice } from "@/components/common/SafeTestModeNotice";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { HermesSchedulerCenter } from "@/components/settings/HermesSchedulerCenter";

export const Route = createFileRoute("/manutencao-programada")({
  head: () => ({
    meta: [
      { title: "NEXT Optimizer - Manutenção Programada" },
      {
        name: "description",
        content: "Tarefas locais e conservadoras do Scheduler Engine NEXT.",
      },
    ],
  }),
  component: ManutencaoProgramadaPage,
});

function ManutencaoProgramadaPage() {
  return (
    <div className="lightning-bg min-h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 px-5 pt-6 pb-4 overflow-auto xl:px-8 xl:pt-7">
          <SafeTestModeNotice />
          <HermesSchedulerCenter />
        </main>
      </div>
    </div>
  );
}
