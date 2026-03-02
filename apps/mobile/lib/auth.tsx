import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, supabaseConfigError } from "@/lib/supabase";

type AuthContextValue = {
  initialized: boolean;
  session: Session | null;
  user: User | null;
  isAuthenticated: boolean;
  authError: string | null;
  signInWithPassword: (email: string, password: string) => Promise<string | null>;
  signUpWithPassword: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [initialized, setInitialized] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const bootstrap = async (): Promise<void> => {
      if (supabaseConfigError) {
        if (mounted) {
          setAuthError(supabaseConfigError);
          setInitialized(true);
        }
        return;
      }

      const { data, error } = await supabase.auth.getSession();
      if (!mounted) {
        return;
      }

      if (error) {
        setAuthError(error.message);
      }

      const nextSession = data.session ?? null;
      const hasValidIdentity = Boolean(nextSession?.user?.email && nextSession?.access_token);

      if (nextSession && !hasValidIdentity) {
        await supabase.auth.signOut({ scope: "local" });
        setSession(null);
      } else {
        setSession(nextSession);
      }
      setInitialized(true);
    };

    void bootstrap();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) {
        return;
      }

      const hasValidIdentity = Boolean(nextSession?.user?.email && nextSession?.access_token);
      if (nextSession && !hasValidIdentity) {
        void supabase.auth.signOut({ scope: "local" });
        setSession(null);
        return;
      }

      setSession(nextSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      initialized,
      session,
      user: session?.user ?? null,
      isAuthenticated: Boolean(session?.user?.email && session?.access_token),
      authError,
      signInWithPassword: async (email: string, password: string): Promise<string | null> => {
        if (supabaseConfigError) {
          return supabaseConfigError;
        }

        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          return error.message;
        }

        return null;
      },
      signUpWithPassword: async (email: string, password: string): Promise<string | null> => {
        if (supabaseConfigError) {
          return supabaseConfigError;
        }

        const { error } = await supabase.auth.signUp({ email, password });
        if (error) {
          return error.message;
        }

        return null;
      },
      signOut: async (): Promise<void> => {
        await supabase.auth.signOut({ scope: "local" });
        setSession(null);
      }
    }),
    [authError, initialized, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthContextValue => {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return value;
};
