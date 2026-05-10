"use client";

import { KeyRound, LogIn, ShieldCheck } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { initialUsername, verifyUserCredential, type LoginVerificationResult } from "../../lib/firebase/user-store";

const authSessionKey = "safa.authSession.v1";

interface StoredAuthSession {
  username: string;
  source: "firestore" | "local";
}

interface AuthGateSession extends StoredAuthSession {
  logout: () => void;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function readStoredSession(): StoredAuthSession | null {
  const raw = window.sessionStorage.getItem(authSessionKey);
  if (!raw) return null;
  if (raw === "ok") return { username: initialUsername, source: "local" };

  try {
    const session = JSON.parse(raw) as Partial<StoredAuthSession>;
    if (!session.username) return null;
    return {
      username: session.username,
      source: session.source === "firestore" ? "firestore" : "local"
    };
  } catch {
    return null;
  }
}

function loginErrorMessage(result: LoginVerificationResult) {
  if (result.reason === "not_found") return "Bu kullanici Firestore'da bulunamadi. Ilk kullanici adi: sarper.";
  if (result.reason === "disabled") return "Bu kullanici pasif durumda. Yetkili kisi kullaniciyi tekrar aktif etmeli.";
  if (result.reason === "mismatch") return "Sifre bu kullanici ile eslesmedi. Kullanici adi veya sifreyi kontrol edin.";
  if (result.reason === "firestore_unavailable") {
    return "Firestore okunamadi. Ilk kullanici icin yerel giris denendi ama bilgiler eslesmedi.";
  }
  return "Kullanici adi veya sifre hatali.";
}

export function AuthGate({ children }: { children: (session: AuthGateSession) => ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<StoredAuthSession | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSession(readStoredSession());
    setReady(true);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const normalizedUser = username.trim().toLocaleLowerCase("tr-TR");
    const hash = await sha256(`${normalizedUser}:${password}`);
    const result = await verifyUserCredential(normalizedUser, hash);

    if (!result.ok) {
      setBusy(false);
      setError(loginErrorMessage(result));
      return;
    }

    const nextSession: StoredAuthSession = { username: normalizedUser, source: result.source };
    window.sessionStorage.setItem(authSessionKey, JSON.stringify(nextSession));
    setSession(nextSession);
    setBusy(false);
    setPassword("");
  }

  function logout() {
    window.sessionStorage.removeItem(authSessionKey);
    setSession(null);
    setUsername("");
    setPassword("");
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
