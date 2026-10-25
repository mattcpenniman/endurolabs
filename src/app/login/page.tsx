/** Google sign-in for existing EnduroLab accounts. */
import { googleConfig, googleLoginRedirect } from "@/lib/google-auth";

const ERRORS: Record<string, string> = {
  google_unavailable: "Google sign-in is not configured yet. Please try again once setup is complete.",
  invalid_state: "Your sign-in attempt expired or could not be verified. Please try again.",
  google_cancelled: "Google sign-in was cancelled. You can try again below.",
  google_failed: "Unable to sign in with Google. Please try again.",
  account_not_found: "No EnduroLab account matches that Google email. Choose the Google account associated with your existing EnduroLab account.",
};

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ redirect?: string | string[]; error?: string | string[] }>;
}): Promise<React.ReactNode> {
  const params = await searchParams;
  const configured = Boolean(googleConfig());
  const errorKey = typeof params.error === "string" && Object.hasOwn(ERRORS, params.error) ? params.error : "";
  const error = configured ? ERRORS[errorKey] : ERRORS.google_unavailable;
  const href = `/api/auth/google?${new URLSearchParams({ redirect: googleLoginRedirect(params.redirect) })}`;

  return (
    <div className="section-padding">
      <section className="container-narrow flex justify-center py-12 sm:py-20">
        <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-8 shadow-sm">
          <div className="mb-8">
            <p className="text-sm font-semibold uppercase tracking-widest text-enduro-500">EnduroLab</p>
            <h1 className="mt-2 text-3xl font-bold" style={{ color: "var(--color-text)" }}>Sign in</h1>
            <p className="mt-2 text-sm" style={{ color: "var(--color-text-secondary)" }}>
              Access your saved training plans with your Google account.
            </p>
          </div>
          {error && <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          {configured && (
            <a href={href} className="flex w-full items-center justify-center gap-3 rounded-lg border border-[var(--color-border)] px-5 py-3 text-sm font-semibold hover:bg-[var(--color-bg-secondary)]">
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 48 48">
                <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5h6.7c3.9-3.6 6-8.8 6-14.9Z" />
                <path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.6l-6.7-5c-1.8 1.2-4.1 1.9-6.8 1.9-5.3 0-9.8-3.6-11.4-8.4H5.7v5.2A20.4 20.4 0 0 0 24 44Z" />
                <path fill="#FBBC05" d="M12.6 27.9a12 12 0 0 1 0-7.8v-5.2H5.7a20 20 0 0 0 0 18.2l6.9-5.2Z" />
                <path fill="#EA4335" d="M24 11.7c3 0 5.6 1 7.7 3l5.8-5.8A19.5 19.5 0 0 0 24 4 20.4 20.4 0 0 0 5.7 14.9l6.9 5.2c1.6-4.8 6.1-8.4 11.4-8.4Z" />
              </svg>
              Continue with Google
            </a>
          )}
          <p className="mt-5 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            Use the same email as your existing EnduroLab account to access your plans and running history.
          </p>
        </div>
      </section>
    </div>
  );
}
