"use client";

import { KeyRound, LogIn, ShieldCheck } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

interface StoredAuthSession {
  username: string;
  source: "api";
}

interface AuthGateSession extends StoredAuthSession {
  logout: () => void;
}

function loginErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Kullanici adi veya sifre hatali.";
}

export function AuthGate({ children }: { children: (session: AuthGateSession) => ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<StoredAuthSession | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    api
      .authSession()
      .then((result) => {
        if (!cancelled && result.authenticated && result.username) {
          setSession({ username: result.username, source: "api" });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setError(loginErrorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const result = await api.login({ username: username.trim(), password });
      if (!result.authenticated || !result.username) {
        setError("Kullanici adi veya sifre hatali.");
        return;
      }

      setSession({ username: result.username, source: "api" });
      setPassword("");
    } catch (error) {
      setError(loginErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    void api.logout().finally(() => {
      setSession(null);
      setUsername("");
      setPassword("");
    });
  }

  if (!ready) return null;
  if (session) return <>{children({ ...session, logout })}</>;

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-label="SAFA giris">
        <div className="brand-lockup auth-brand">
          <span className="brand-mark">S</span>
          <span>
            <strong>SAFA</strong>
            <small>Commerce OS</small>
          </span>
        </div>

        <div className="auth-copy">
          <span className="micro-label">Giris gerekli</span>
          <h1>Operasyon paneline giris</h1>
          <p>Platforma devam etmek icin tanimli kullanici bilgileriyle oturum acin.</p>
        </div>

        <form className="settings-form auth-form" onSubmit={submit}>
          <label className="field">
            <span>
              <ShieldCheck size={17} />
              Kullanici adi
            </span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
            />
          </label>
          <label className="field">
            <span>
              <KeyRound size={17} />
              Sifre
            </span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error ? <div className="form-alert danger">{error}</div> : null}
          <button className="ui-button primary" type="submit" disabled={busy}>
            <LogIn size={18} />
            Giris yap
          </button>
        </form>
      </section>
    </main>
  );
}
