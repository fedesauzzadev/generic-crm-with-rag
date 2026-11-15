import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// Sesión demo respaldada por cookie HttpOnly firmada (D-006): el server es la
// fuente de verdad (/api/auth/*), la SPA solo la refleja. Login de un campo,
// siempre acepta (AC H-03); el nombre es el actor de trazas de S03.

interface Session {
  name: string;
}

type SessionStatus = "loading" | "authenticated" | "anonymous";

interface SessionContextValue {
  session: Session | null;
  status: SessionStatus;
  login: (name: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");

  // Al montar: ¿hay cookie válida? (sobrevive recarga de página)
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then(async (res) => (res.ok ? ((await res.json()) as { user?: Session }) : null))
      .then((body) => {
        if (!alive) return;
        setSession(body?.user ?? null);
        setStatus(body?.user ? "authenticated" : "anonymous");
      })
      .catch(() => {
        if (alive) setStatus("anonymous");
      });
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (name: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() || undefined }), // vacío → server default "Guest"
    });
    if (!res.ok) throw new Error(`Login failed with status ${res.status}`);
    const body = (await res.json()) as { user: Session };
    setSession(body.user);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setSession(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo(() => ({ session, status, login, logout }), [session, status, login, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
