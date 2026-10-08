/** Serverless functions must release shared Supabase connections between transactions. */
export function agentConnectionUrl(value: string): string {
  const url = new URL(value);
  if ((url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
      (url.port === "5432" || url.port === "")) {
    url.port = "6543";
    return url.href;
  }
  return value;
}

export const AGENT_CONNECTION_OPTIONS = {
  prepare: false,
  max: 1,
  max_pipeline: 0,
  connect_timeout: 10,
  idle_timeout: 10,
} as const;

// postgres.js 3.4.9 does not initialize sql.begin() with max_pipeline: 0.
// A dedicated pool only runs explicit transactions: BEGIN pins the backend
// before its callback can issue any query, so transaction-local RLS stays intact.
export const AGENT_TRANSACTION_OPTIONS = { ...AGENT_CONNECTION_OPTIONS, max_pipeline: 1 } as const;
