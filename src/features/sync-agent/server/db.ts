import "server-only";
import postgres from "postgres";
let connection: ReturnType<typeof postgres> | undefined;
export function agentDb() {
  if (!process.env.DATABASE_URL) throw new Error("연동 PC 서비스를 준비 중입니다.");
  return connection ??= postgres(process.env.DATABASE_URL, { prepare: false, max: 4, connect_timeout: 10, idle_timeout: 20 });
}
