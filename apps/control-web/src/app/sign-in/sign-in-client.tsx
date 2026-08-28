'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import styles from './sign-in.module.css';

const cloudApiBase = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://localhost:3001';

type Step = 'credentials' | 'verify' | 'success';
type Direction = 'forward' | 'back';

type ErrorPayload = { message?: unknown };

class AuthRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function authRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('x-event-control-request', 'browser');
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${cloudApiBase}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  const payload = (await response.json().catch(() => ({}))) as ErrorPayload & T;
  if (!response.ok) {
    const message = typeof payload.message === 'string' ? payload.message : 'Unable to sign in';
    throw new AuthRequestError(message, response.status);
  }
  return payload;
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  return hidden ? (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a20.6 20.6 0 0 1 5.06-5.94M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 7 11 7a20.6 20.6 0 0 1-3.22 4.36M1 1l22 22" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    </svg>
  ) : (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l7 3v6c0 5-3.5 7.5-7 9-3.5-1.5-7-4-7-9V6l7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg className={`${styles.icon} ${styles.bannerIcon}`} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  );
}

function friendlyError(error: unknown, phase: 'password' | 'verify' | 'resend'): string {
  if (!(error instanceof AuthRequestError)) return 'Event Control could not complete the request.';
  if (error.status === 429) return 'Too many attempts. Wait a moment and try again.';
  if (error.status >= 500)
    return 'Sign-in services are temporarily unavailable. Try again shortly.';
  if (phase === 'password')
    return 'Incorrect email or password. Check your credentials and try again.';
  if (phase === 'verify') return 'That verification code is incorrect or has expired.';
  return error.message || 'The verification code could not be resent.';
}

export function SignInClient() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('credentials');
  const [direction, setDirection] = useState<Direction>('forward');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [maskedEmail, setMaskedEmail] = useState('');
  const [code, setCode] = useState('');
  const [seconds, setSeconds] = useState(60);
  const [codeError, setCodeError] = useState(false);
  const codeRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    void authRequest('/operator-auth/session', { method: 'GET' })
      .then(() => {
        if (active) router.replace('/');
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (step !== 'verify') return;
    setSeconds(60);
    const interval = window.setInterval(() => {
      setSeconds((current) => {
        if (current <= 1) {
          window.clearInterval(interval);
          return 0;
        }
        return current - 1;
      });
    }, 1_000);
    window.setTimeout(() => codeRef.current?.focus(), 250);
    return () => window.clearInterval(interval);
  }, [step]);

  async function submitCredentials(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const result = await authRequest<{ maskedEmail: string; resendAfterSeconds: number }>(
        '/operator-auth/login/password',
        {
          method: 'POST',
          body: JSON.stringify({ email, password, rememberDevice: remember }),
        },
      );
      setMaskedEmail(result.maskedEmail);
      setCode('');
      setDirection('forward');
      setStep('verify');
    } catch (failure) {
      setError(friendlyError(failure, 'password'));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!/^\d{6,10}$/.test(code)) return;
    setBusy(true);
    setError(null);
    setCodeError(false);
    try {
      await authRequest('/operator-auth/login/verify', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      setDirection('forward');
      setStep('success');
      window.setTimeout(() => router.replace('/'), 650);
    } catch (failure) {
      setError(friendlyError(failure, 'verify'));
      setCodeError(true);
      setCode('');
      window.setTimeout(() => codeRef.current?.focus(), 50);
    } finally {
      setBusy(false);
    }
  }

  async function resendCode(): Promise<void> {
    if (seconds > 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await authRequest<{ resendAfterSeconds: number }>(
        '/operator-auth/login/resend',
        {
          method: 'POST',
        },
      );
      setSeconds(result.resendAfterSeconds);
    } catch (failure) {
      setError(friendlyError(failure, 'resend'));
    } finally {
      setBusy(false);
    }
  }

  function back(): void {
    setDirection('back');
    setStep('credentials');
    setCode('');
    setCodeError(false);
    setError(null);
  }

  const stepClass = direction === 'back' ? styles.stepBack : styles.stepForward;
  const codeComplete = /^\d{6,10}$/.test(code);

  return (
    <main className={styles.shell}>
      <section className={styles.leftPanel} aria-label="Event Control">
        <div className={styles.brand}>
          <div className={styles.brandMark}>EC</div>
          <div>
            <div className={styles.brandName}>Event Control</div>
            <div className={styles.brandMeta}>Event Commerce OS</div>
          </div>
        </div>

        <div className={styles.leftBody}>
          <h1 className={styles.headline}>Run live events without losing control.</h1>
          <p className={styles.subhead}>
            Sales, inventory, devices, payments and sync — one command centre, built for operators
            who can&apos;t afford to guess.
          </p>
          <div className={styles.preview} aria-label="Illustrative Event Control status">
            <div className={styles.previewHead}>
              <span className={styles.previewTitle}>NAIROBI EXPO 2026</span>
              <span className={styles.live}>
                <span className={styles.liveDot} />
                LIVE
              </span>
            </div>
            <div className={styles.statGrid}>
              <div>
                <div className={styles.statLabel}>Sales today</div>
                <div className={styles.statValue}>KES 4.82M</div>
              </div>
              <div>
                <div className={styles.statLabel}>Sync health</div>
                <div className={`${styles.statValue} ${styles.healthy}`}>99.8%</div>
              </div>
            </div>
            <div className={styles.chips}>
              <span className={styles.chip}>
                <span className={`${styles.chipDot} ${styles.greenDot}`} />
                Payments healthy
              </span>
              <span className={styles.chip}>
                <span className={`${styles.chipDot} ${styles.amberDot}`} />
                Inventory · 12 at risk
              </span>
              <span className={styles.chip}>
                <span className={`${styles.chipDot} ${styles.redDot}`} />
                Devices · 3 offline
              </span>
            </div>
          </div>
        </div>

        <div className={styles.leftFooter}>
          © 2026 Event Commerce OS. Operator access is logged and audited.
        </div>
      </section>

      <section className={styles.rightPanel}>
        <div className={styles.formWrap}>
          <div className={styles.mobileBrand}>
            <div className={styles.mobileMark}>EC</div>
            <strong>Event Control</strong>
          </div>

          {step === 'credentials' ? (
            <div className={stepClass}>
              <h2 className={styles.formTitle}>Sign in to Event Control</h2>
              <p className={styles.formSub}>Operate live events with confidence.</p>

              {error ? (
                <div className={styles.banner}>
                  <AlertIcon />
                  <div>
                    <strong>Sign-in failed.</strong> {error}
                  </div>
                </div>
              ) : null}
              {info ? (
                <div className={`${styles.banner} ${styles.infoBanner}`}>
                  <ShieldIcon />
                  <div>{info}</div>
                </div>
              ) : null}

              <form onSubmit={(event) => void submitCredentials(event)}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="operator-email">
                    Work email
                  </label>
                  <input
                    className={styles.input}
                    id="operator-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    disabled={busy}
                  />
                </div>

                <div className={styles.field}>
                  <div className={styles.fieldLabelRow}>
                    <label className={styles.fieldLabel} htmlFor="operator-password">
                      Password
                    </label>
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => {
                        setError(null);
                        setInfo(
                          'Password recovery is administrator-managed during the pilot. Contact your Event Control administrator to reset access.',
                        );
                      }}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className={styles.inputWrap}>
                    <input
                      className={`${styles.input} ${styles.passwordInput} ${error ? styles.invalidInput : ''}`}
                      id="operator-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className={styles.passwordToggle}
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      <EyeIcon hidden={showPassword} />
                    </button>
                  </div>
                </div>

                <label className={styles.rememberRow}>
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                    disabled={busy}
                  />
                  <span>Remember this device for 30 days</span>
                </label>

                <button
                  className={styles.primaryButton}
                  type="submit"
                  disabled={busy || !email.trim() || !password}
                >
                  {busy ? (
                    <>
                      <span className={styles.spinner} />
                      Signing in…
                    </>
                  ) : (
                    'Sign in'
                  )}
                </button>
              </form>

              <div className={styles.footer}>
                <div className={styles.footerNote}>
                  <ShieldIcon />
                  Protected by enterprise-grade security
                </div>
                <div className={styles.footerLinks}>No account? Contact your administrator.</div>
              </div>
            </div>
          ) : null}

          {step === 'verify' ? (
            <div className={stepClass}>
              <button type="button" className={styles.backButton} onClick={back} disabled={busy}>
                <BackIcon />
                Back
              </button>
              <h2 className={styles.formTitle}>Enter verification code</h2>
              <p className={styles.formSub}>
                We sent a verification code to <strong>{maskedEmail}</strong>.
              </p>
              {error ? (
                <div className={styles.banner}>
                  <AlertIcon />
                  <div>{error}</div>
                </div>
              ) : null}

              <form onSubmit={(event) => void submitCode(event)}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="verification-code">
                    Verification code
                  </label>
                  <input
                    ref={codeRef}
                    className={`${styles.input} ${codeError ? styles.invalidInput : ''}`}
                    id="verification-code"
                    name="verification-code"
                    value={code}
                    onChange={(event) => {
                      setCode(event.target.value.replace(/\D/g, '').slice(0, 10));
                      setCodeError(false);
                    }}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={10}
                    placeholder="Enter the code from your email"
                    aria-invalid={codeError}
                    disabled={busy}
                  />
                </div>
                <button
                  className={styles.primaryButton}
                  type="submit"
                  disabled={!codeComplete || busy}
                >
                  {busy ? (
                    <>
                      <span className={styles.spinner} />
                      Verifying…
                    </>
                  ) : (
                    'Verify and sign in'
                  )}
                </button>
              </form>

              <div className={styles.footer}>
                <div className={styles.resendRow}>
                  {seconds > 0 ? (
                    <>
                      Resend code in{' '}
                      <span className={styles.timer}>0:{String(seconds).padStart(2, '0')}</span>
                    </>
                  ) : (
                    <>
                      <span>Didn&apos;t get a code?</span>
                      <button
                        className={styles.resendButton}
                        type="button"
                        onClick={() => void resendCode()}
                        disabled={busy}
                      >
                        Resend
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {step === 'success' ? (
            <div className={styles.success}>
              <div className={styles.checkWrap}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m5 12 5 5L20 7" />
                </svg>
              </div>
              <h2 className={styles.formTitle}>You&apos;re in</h2>
              <p className={styles.formSub}>Redirecting to Event Control…</p>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
