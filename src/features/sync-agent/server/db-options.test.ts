import { describe, expect, it } from "vitest";
import { agentConnectionUrl, AGENT_CONNECTION_OPTIONS, AGENT_TRANSACTION_OPTIONS } from "./db-options";

describe("agent database connection", () => {
  it("uses the same Supabase project and credentials through the transaction endpoint", () => {
    const original = new URL("postgresql://postgres.fixture:p%40ss%25@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require&application_name=agent");
    const result = new URL(agentConnectionUrl(original.href));
    expect(result.port).toBe("6543");
    for (const key of ["hostname", "username", "password", "pathname", "search"] as const) expect(result[key]).toBe(original[key]);
  });
  it("handles the implicit PostgreSQL session port", () => {
    expect(new URL(agentConnectionUrl("postgres://postgres.fixture:fixture@aws-0-eu-west-1.pooler.supabase.com/postgres")).port).toBe("6543");
  });
  it.each([
    "postgres://postgres:fixture@127.0.0.1:5432/fixture",
    "postgres://postgres:fixture@db.fixture.supabase.co:5432/postgres",
    "postgres://postgres.fixture:fixture@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres",
    "postgres://postgres:fixture@aws-1-ap-northeast-2.pooler.supabase.com.attacker.test:5432/postgres",
    "postgres://postgres:fixture@custom.pooler.test:5432/postgres",
  ])("preserves direct, fixture, configured transaction and other-provider URLs: %s", value => {
    expect(agentConnectionUrl(value)).toBe(value);
  });
  it("does not allocate a multi-connection pool per function or use prepared statements", () => {
    expect(AGENT_CONNECTION_OPTIONS).toMatchObject({ max: 1, max_pipeline: 0, prepare: false });
    expect(AGENT_TRANSACTION_OPTIONS).toMatchObject({ max: 1, max_pipeline: 1, prepare: false });
    expect(AGENT_CONNECTION_OPTIONS.idle_timeout).toBeLessThan(20);
  });
});
