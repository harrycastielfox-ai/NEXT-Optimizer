import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import "../styles.css";
import { HermesWindowChrome } from "../components/common/HermesWindowChrome";
import { NexLicenseGate } from "../components/licensing/NexLicenseGate";
import { NexCompanionController } from "../components/nex-companion/NexCompanionController";
import { reportClientError } from "../lib/lovable-error-reporting";
import { NexAuthProvider } from "../lib/nex-auth";
import { HermesPreferencesProvider } from "../lib/preferences";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A página solicitada não existe ou foi movida.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Voltar ao Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportClientError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Esta tela não carregou
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Algo impediu o carregamento. Tente novamente ou volte ao Dashboard.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Tentar novamente
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Voltar ao Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "NEXT Optimizer" },
      { name: "description", content: "Painel central do PC com coleta local somente leitura." },
      { name: "author", content: "NEXT Optimizer" },
      { property: "og:title", content: "NEXT Optimizer" },
      {
        property: "og:description",
        content: "Painel central do PC com coleta local somente leitura.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@NEXOptimizer" },
      { name: "twitter:title", content: "NEXT Optimizer" },
      {
        name: "twitter:description",
        content: "Painel central do PC com coleta local somente leitura.",
      },
      {
        property: "og:image",
        content: "/nex-logo.png",
      },
      {
        name: "twitter:image",
        content: "/nex-logo.png",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <HermesPreferencesProvider>
        <RootSurface />
      </HermesPreferencesProvider>
    </QueryClientProvider>
  );
}

// Recovery must remain reachable when a subscription expires or the network is offline.
const PUBLIC_LICENSE_ROUTES = new Set(["/admin/licencas", "/seguranca"]);

function RootSurface() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  if (pathname === "/companion") {
    return <Outlet />;
  }

  return (
    <NexAuthProvider>
      <HermesWindowChrome />
      <NexCompanionController />
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <LicenseAwareOutlet />
    </NexAuthProvider>
  );
}

function LicenseAwareOutlet() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const outlet = <Outlet />;

  if (PUBLIC_LICENSE_ROUTES.has(pathname)) return outlet;
  return <NexLicenseGate>{outlet}</NexLicenseGate>;
}
