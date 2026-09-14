import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { LICENSE_PUBLISHABLE_KEY, LICENSE_SERVER_URL } from "./license-server";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from "react";

export type NexPlan = {
  id: string;
  name: string;
  durationDays: number;
  priceCents: number;
  featured?: boolean;
};

export type NexEntitlement = {
  userId: string;
  planId: string;
  planName: string;
  status: "active" | "expired" | "revoked";
  startsAt: string;
  expiresAt: string;
};

export type NexDeviceIdentity = {
  fingerprint: string;
  label: string;
  source: string;
};

export type NexUser = {
  id: string;
  email: string;
  user_metadata: {
    full_name?: string | null;
    avatar_url?: string | null;
  };
};

export type NexLicenseSession = {
  accountId: string | null;
  email: string;
  entitlement: NexEntitlement | null;
  access: NexDeviceAccess;
  verifiedAt: string;
};

export type NexDeviceAccess =
  | "checking"
  | "allowed"
  | "unlicensed"
  | "expired"
  | "revoked"
  | "blocked"
  | "unavailable";

export const NEX_PLANS: NexPlan[] = [
  { id: "15_days", name: "15 dias", durationDays: 15, priceCents: 1729 },
  { id: "30_days", name: "30 dias", durationDays: 30, priceCents: 3458 },
  { id: "3_months", name: "3 meses", durationDays: 90, priceCents: 8990 },
  { id: "6_months", name: "6 meses", durationDays: 180, priceCents: 15990 },
  {
    id: "1_year",
    name: "1 ano",
    durationDays: 365,
    priceCents: 27990,
    featured: true,
  },
];

type LicenseFunctionResponse = {
  ok?: boolean;
  error?: string;
  account?: {
    id: string | null;
    email: string;
  };
  access?: NexDeviceAccess;
  accessReason?: string;
  entitlement?: NexEntitlement | null;
};

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: NexLicenseSession | null;
  rememberedEmail: string | null;
  user: NexUser | null;
  entitlement: NexEntitlement | null;
  deviceIdentity: NexDeviceIdentity | null;
  deviceAccess: NexDeviceAccess;
  error: string | null;
  activateWithEmailCode: (email: string, code: string) => Promise<NexEntitlement>;
  verifyEmailAccess: (email: string) => Promise<NexEntitlement>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  redeemCode: (code: string, email?: string) => Promise<NexEntitlement>;
  refreshEntitlement: (options?: { force?: boolean }) => Promise<void>;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const supabaseUrl = (
  import.meta.env.VITE_SUPABASE_URL ??
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ??
  LICENSE_SERVER_URL
)?.trim();
const supabasePublishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  LICENSE_PUBLISHABLE_KEY
)?.trim();
const storeUrl = import.meta.env.VITE_NEX_STORE_URL?.trim();

let browserClient: SupabaseClient | null = null;
let deviceIdentityPromise: Promise<NexDeviceIdentity> | null = null;
const LICENSE_SESSION_STORAGE_KEY = "nex.auth.email-license-session.v1";
const LICENSE_REMEMBERED_EMAIL_STORAGE_KEY = "nex.auth.remembered-email.v1";

export function isNexAuthConfigured() {
  if (isTauriRuntime()) return true;
  const hasRealProjectUrl = Boolean(
    supabaseUrl &&
    /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl) &&
    !supabaseUrl.includes("seu-projeto"),
  );
  const hasRealPublishableKey = Boolean(
    supabasePublishableKey &&
    /^(sb_publishable_|eyJ)/.test(supabasePublishableKey) &&
    !supabasePublishableKey.includes("substitua"),
  );

  return hasRealProjectUrl && hasRealPublishableKey;
}

function getSupabaseClient() {
  if (!supabaseUrl || !supabasePublishableKey || typeof window === "undefined") {
    return null;
  }

  if (!browserClient) {
    browserClient = createClient(supabaseUrl!, supabasePublishableKey!, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }

  return browserClient;
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function openNexExternalUrl(url: string) {
  if (isTauriRuntime()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }

  window.location.assign(url);
}

export function getNexStoreUrl() {
  return storeUrl || null;
}

export async function invokeNexLicenseAdmin<T = Record<string, unknown>>(
  payload: Record<string, unknown>,
  adminKey?: string,
) {
  const client = getSupabaseClient();
  const normalizedAdminKey = adminKey?.trim();
  if (!normalizedAdminKey) throw new Error("ADMIN_KEY_REQUIRED");
  if (!client) throw new Error("O servidor de licenças ainda não foi configurado.");

  const { data, error } = await client.functions.invoke("nex-license-admin", {
    body: payload,
    headers: {
      "x-nex-admin-key": normalizedAdminKey,
    },
  });
  if (error) {
    let message = error.message;
    const response = "context" in error ? (error.context as Response | undefined) : undefined;
    if (response) {
      try {
        const body = (await response.clone().json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        // Keep the SDK message for non-JSON responses.
      }
    }
    throw new Error(message);
  }

  return data as T;
}

async function getDeviceIdentity(): Promise<NexDeviceIdentity> {
  if (!isTauriRuntime()) throw new Error("DEVICE_IDENTITY_APP_REQUIRED");
  deviceIdentityPromise ??= import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke<NexDeviceIdentity>("nex_device_identity"))
    .catch((error) => {
      deviceIdentityPromise = null;
      throw error;
    });
  return deviceIdentityPromise;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function readRememberedEmail() {
  if (typeof window === "undefined") return null;
  return (
    normalizeEmail(window.localStorage.getItem(LICENSE_REMEMBERED_EMAIL_STORAGE_KEY) ?? "") || null
  );
}

function writeRememberedEmail(email: string | null) {
  if (typeof window === "undefined") return;
  const normalizedEmail = email ? normalizeEmail(email) : "";
  if (!normalizedEmail) {
    window.localStorage.removeItem(LICENSE_REMEMBERED_EMAIL_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(LICENSE_REMEMBERED_EMAIL_STORAGE_KEY, normalizedEmail);
}

function makeUserFromSession(session: NexLicenseSession | null): NexUser | null {
  if (!session) return null;
  return {
    id: session.accountId ?? session.email,
    email: session.email,
    user_metadata: {
      full_name: session.email,
      avatar_url: null,
    },
  };
}

function friendlyAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/CODE_INVALID_OR_ALREADY_USED/i.test(message)) {
    return "Este código é inválido ou já foi utilizado.";
  }
  if (/CODE_EXPIRED/i.test(message)) {
    return "Este código expirou e não pode mais ser utilizado.";
  }
  if (/CODE_ASSIGNED_TO_ANOTHER_ACCOUNT/i.test(message)) {
    return "Este código pertence a outro e-mail.";
  }
  if (/CODE_NOT_ASSIGNED/i.test(message)) {
    return "Este código ainda não foi associado ao e-mail da compra.";
  }
  if (/ACCOUNT_EMAIL_REQUIRED/i.test(message)) {
    return "Digite o e-mail usado na compra.";
  }
  if (/DEVICE_ALREADY_BOUND|DEVICE_MISMATCH/i.test(message)) {
    return "Esta licença já está vinculada a outro computador.";
  }
  if (/INVALID_DEVICE/i.test(message)) {
    return "Não foi possível validar a identidade segura deste computador.";
  }
  if (/DEVICE_IDENTITY_APP_REQUIRED/i.test(message)) {
    return "Abra o NEXT instalado no Windows para ativar esta licença.";
  }
  if (/SERVER_NOT_CONFIGURED/i.test(message)) {
    return "O servidor de licenças ainda não foi configurado.";
  }
  if (/LICENSE_NOT_FOUND|NO_ENTITLEMENT/i.test(message)) {
    return "Nenhum acesso ativo foi encontrado para este e-mail neste computador.";
  }
  if (/LICENSE_SESSION_REQUIRED|LICENSE_SESSION_INVALID|LICENSE_REQUIRED/i.test(message)) {
    return "Ative novamente com o código original da compra neste computador. Para trocar de PC, procure o suporte.";
  }
  if (/ACTIVATION_DENIED/i.test(message)) {
    return "Não foi possível ativar. Confira o e-mail, o código original e o computador vinculado. Se necessário, procure o suporte.";
  }
  if (/RATE_LIMITED/i.test(message))
    return "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.";
  if (/network|fetch|Failed to fetch/i.test(message)) {
    return "Não foi possível acessar o servidor de licenças. Verifique sua conexão.";
  }
  return message;
}

async function invokeLicenseSession(action: "activate" | "verify", email?: string, code?: string) {
  if (!isTauriRuntime()) throw new Error("DEVICE_IDENTITY_APP_REQUIRED");
  const { invoke } = await import("@tauri-apps/api/core");
  // The native layer obtains the device identity, talks to the server and holds the credential.
  // JavaScript never receives a token and cannot grant native authorization.
  const result = await invoke<LicenseFunctionResponse>(
    action === "activate" ? "nex_license_activate" : "nex_license_verify",
    action === "activate" ? { email: normalizeEmail(email ?? ""), code } : undefined,
  );
  if (!result?.ok) throw new Error(result?.error ?? "LICENSE_SESSION_INVALID");
  return result;
}

function buildSession(email: string, result: LicenseFunctionResponse): NexLicenseSession {
  const access = result.access ?? "unavailable";
  return {
    accountId: result.account?.id ?? null,
    email: normalizeEmail(result.account?.email ?? email),
    entitlement: result.entitlement ?? null,
    access,
    verifiedAt: new Date().toISOString(),
  };
}

export function NexAuthProvider({ children }: { children: ReactNode }) {
  const configured = isNexAuthConfigured();
  const [loading, setLoading] = useState(configured);
  const [session, setSession] = useState<NexLicenseSession | null>(null);
  const [rememberedEmail, setRememberedEmail] = useState<string | null>(readRememberedEmail);
  const [deviceIdentity, setDeviceIdentity] = useState<NexDeviceIdentity | null>(null);
  const [deviceAccess, setDeviceAccess] = useState<NexDeviceAccess>("unlicensed");
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const entitlement = session?.entitlement ?? null;
  const hasSession = session !== null;

  const setLicenseSession = useCallback((next: NexLicenseSession | null) => {
    setSession(next);
    setDeviceAccess(next?.access ?? "unlicensed");
    if (next?.email) {
      setRememberedEmail(next.email);
      writeRememberedEmail(next.email);
    }
  }, []);

  const refreshEntitlement = useCallback(
    async (_options?: { force?: boolean }) => {
      const version = ++requestVersion.current;
      if (!configured || !isTauriRuntime()) {
        setLicenseSession(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const result = await invokeLicenseSession("verify");
        if (version !== requestVersion.current) return;
        setLicenseSession(buildSession(result.account?.email ?? "", result));
        setError(null);
      } catch (loadError) {
        if (version !== requestVersion.current) return;
        setLicenseSession(null);
        const message = loadError instanceof Error ? loadError.message : String(loadError);
        setDeviceAccess(
          /LICENSE_SESSION_REQUIRED|LICENSE_REQUIRED/i.test(message) ? "unlicensed" : "unavailable",
        );
        setError(friendlyAuthError(loadError));
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    },
    [configured, setLicenseSession],
  );

  useEffect(() => {
    // Old cached access was editable by the browser. Discard it; keep only the email hint.
    window.localStorage.removeItem(LICENSE_SESSION_STORAGE_KEY);
    if (isTauriRuntime())
      void getDeviceIdentity()
        .then(setDeviceIdentity)
        .catch(() => {});
    void refreshEntitlement();
    return () => {
      requestVersion.current += 1;
    };
  }, [refreshEntitlement]);

  useEffect(() => {
    if (!hasSession) return;
    const refresh = () => void refreshEntitlement();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [refreshEntitlement, hasSession]);

  const activateWithEmailCode = useCallback(
    async (email: string, code: string) => {
      const version = ++requestVersion.current;
      try {
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail) throw new Error("Digite o e-mail usado na compra.");
        if (code.trim().length < 8) throw new Error("Digite um código NEXT válido.");
        const result = await invokeLicenseSession("activate", normalizedEmail, code.trim());
        const next = buildSession(normalizedEmail, result);
        if (!next.entitlement || next.access !== "allowed")
          throw new Error("O acesso não foi liberado.");
        if (version === requestVersion.current) {
          setLicenseSession(next);
          setError(null);
          setLoading(false);
        }
        return next.entitlement;
      } catch (activationError) {
        throw new Error(friendlyAuthError(activationError));
      }
    },
    [setLicenseSession],
  );

  const verifyEmailAccess = useCallback(
    async (_email: string) => {
      const version = ++requestVersion.current;
      try {
        // Email is an input hint only. Verification always uses the native stored credential.
        const result = await invokeLicenseSession("verify");
        const next = buildSession(result.account?.email ?? "", result);
        if (!next.entitlement || next.access !== "allowed")
          throw new Error("LICENSE_SESSION_INVALID");
        if (version === requestVersion.current) {
          setLicenseSession(next);
          setError(null);
          setLoading(false);
        }
        return next.entitlement;
      } catch (verifyError) {
        if (version === requestVersion.current) setLicenseSession(null);
        throw new Error(friendlyAuthError(verifyError));
      }
    },
    [setLicenseSession],
  );

  const signInWithGoogle = useCallback(async () => {
    setError("Use o e-mail e o código original da compra para ativar o acesso.");
  }, []);

  const signOut = useCallback(async () => {
    ++requestVersion.current;
    try {
      if (isTauriRuntime()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("nex_license_sign_out");
      }
    } finally {
      setLicenseSession(null);
      setLoading(false);
      window.localStorage.removeItem(LICENSE_SESSION_STORAGE_KEY);
    }
  }, [setLicenseSession]);

  const redeemCode = useCallback(
    (code: string, email?: string) => activateWithEmailCode(email ?? session?.email ?? "", code),
    [activateWithEmailCode, session?.email],
  );
  const clearError = useCallback(() => setError(null), []);
  const value = useMemo<AuthContextValue>(
    () => ({
      configured,
      loading,
      session,
      rememberedEmail,
      user: makeUserFromSession(session),
      entitlement,
      deviceIdentity,
      deviceAccess,
      error,
      activateWithEmailCode,
      verifyEmailAccess,
      signInWithGoogle,
      signOut,
      redeemCode,
      refreshEntitlement,
      clearError,
    }),
    [
      configured,
      loading,
      session,
      rememberedEmail,
      entitlement,
      deviceIdentity,
      deviceAccess,
      error,
      activateWithEmailCode,
      verifyEmailAccess,
      signInWithGoogle,
      signOut,
      redeemCode,
      refreshEntitlement,
      clearError,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useNexAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useNexAuth must be used inside NexAuthProvider.");
  return context;
}
