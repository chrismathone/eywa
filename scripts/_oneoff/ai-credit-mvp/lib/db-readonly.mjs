// 크레딧 MVP 추출 단계 전용 — 운영 DB를 **읽기 전용으로만** 연다(2026-10-26).
// 실행: node --env-file=D:/eywa_refactoring/.env.local scripts/_oneoff/ai-credit-mvp/<추출 스크립트>.mjs
// 🔴 평가 단계(AI 호출)에는 이 모듈도 .env.local도 싣지 않는다 — SUPABASE_*가 있으면 generateJSON이 운영 ai_usage_logs에 쓴다.
// 🔴 접속 정보·키 값은 출력하지 않는다.
import postgres from "postgres";

/** 연결 1개 · 세션 읽기 전용 · 문장 제한 시간. 읽기 전용이 실측으로 확인되지 않으면 던진다(추출 중단). */
export async function openReadOnly({ statementTimeoutMs = 60_000 } = {}) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL이 없습니다 — 추출 단계에서만 .env.local을 싣는다");
  const sql = postgres(url, { ssl: "require", max: 1, prepare: false, idle_timeout: 20, connection: { application_name: "aywa-ai-credit-mvp-readonly" } });
  await sql`set session characteristics as transaction read only`;
  await sql.unsafe(`set statement_timeout = ${Number(statementTimeoutMs)}`);
  const [{ default_transaction_read_only: ro }] = await sql`show default_transaction_read_only`;
  if (ro !== "on") { await closeReadOnly(sql); throw new Error("읽기 전용 세션을 확인하지 못했습니다 — 추출 중단"); }
  // 실측: 쓰기 시도(세션 임시 표)가 거절돼야 한다(25006 read_only_sql_transaction). 성공하면 즉시 중단.
  let refused = false;
  try { await sql`create temp table _aywa_ro_probe (x int)`; } catch (e) { refused = e?.code === "25006"; }
  if (!refused) { await closeReadOnly(sql); throw new Error("읽기 전용 실측 실패(쓰기가 거절되지 않음) — 추출 중단"); }
  return sql;
}

/**
 * 닫기 — 세션 설정(읽기 전용 · 제한 시간)을 되돌린 뒤 끊는다. 세션 모드 풀러는 끊은 서버 연결을 다른 손님에게 넘길 수 있어,
 * 읽기 전용이 남은 채 넘어가면 그 손님의 쓰기가 막힌다(적대 리뷰 2026-10-26). 되돌리기에 실패해도 연결은 끊는다.
 */
export async function closeReadOnly(sql) {
  try { await sql`reset all`; } catch { /* 끊는 것이 우선 */ }
  await sql.end();
}

/** 침산(cs) 지점 id — 이번 MVP는 침산만 읽는다(지점 자료 혼합 금지). */
export async function tenantIdOf(sql, slug = "cs") {
  const rows = await sql`select id from tenants where slug = ${slug}`;
  if (rows.length !== 1) throw new Error(`지점 ${slug}를 찾지 못했습니다`);
  return rows[0].id;
}
