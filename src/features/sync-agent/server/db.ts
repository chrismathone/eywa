import "server-only";
import { agentConnectionUrl } from "./db-options";
import { createAgentConnection } from "./connection";
let connection: ReturnType<typeof createAgentConnection> | undefined;
export function agentDb() {
  if (!process.env.DATABASE_URL) throw new Error("연동 PC 서비스를 준비 중입니다.");
  return connection ??= createAgentConnection(agentConnectionUrl(process.env.DATABASE_URL));
}
