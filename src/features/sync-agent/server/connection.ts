import postgres from "postgres";
import { AGENT_CONNECTION_OPTIONS, AGENT_TRANSACTION_OPTIONS } from "./db-options";

export function createAgentConnection(url: string): ReturnType<typeof postgres> {
  const statements = postgres(url, AGENT_CONNECTION_OPTIONS);
  const transactions = postgres(url, AGENT_TRANSACTION_OPTIONS);
  const endStatements = statements.end;
  // The transaction pool is never used for standalone queries. Native BEGIN
  // reserves its connection through commit/rollback, including role and locks.
  statements.begin = transactions.begin;
  statements.end = async options => {
    await Promise.all([endStatements(options), transactions.end(options)]);
  };
  return statements;
}
