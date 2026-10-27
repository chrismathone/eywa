/**
 * 청구서 배분 따라 고치기 트리거(`relink_session_receipt_allocations`)는 **정의자 권한**이어야 한다(0413a).
 *
 * 2026-10-10부터 메이크에듀 수납 동기화가 매번 42501로 실패했다 — 연동 PC 계정(`eywa_sync_agent`)이 청구서를 고치면 이 트리거가
 * 배분 표(`invoice_session_terms`)를 고치는데, 호출자 권한(0354a의 `security invoker`)이라 그 계정에 없는 권한으로 막혔다.
 * 🔴 이 저장소는 "본문 그대로 create or replace"로 함수를 고치는 일이 많다 — 0354a를 복사해 고치거나 되돌리면(0354a 머리 주석의
 *    되돌리기 = 0267d 재적용) 정의자 권한이 **조용히** 빠지고 동기화가 다시 멈춘다. 그래서 마지막으로 이 함수를 만지는 문장을 잠근다.
 * ⚠️ 이 가드가 초록이어도 운영 DB가 같다는 뜻은 아니다(SQL은 사람이 적용한다) — 의심되면 `pg_proc.prosecdef`를 직접 볼 것.
 */
import { expect, it } from "vitest";
import { migrationFiles } from "@/lib/db/migrations-corpus.mjs";

const TOUCHES = /(?:create\s+(?:or\s+replace\s+)?|alter\s+)function\s+(?:public\.)?relink_session_receipt_allocations\s*\(/gi;

/** 그 자리에서 시작하는 문장 하나 — 달러 따옴표 본문(`$$ … $$`)이 있으면 그 뒤의 `;`까지. */
function statementAt(sql: string, start: number): string {
  const rest = sql.slice(start);
  const semi = rest.indexOf(";");
  const quote = rest.match(/\$[A-Za-z_]*\$/);
  if (!quote || quote.index === undefined || (semi >= 0 && semi < quote.index)) return rest.slice(0, semi < 0 ? undefined : semi + 1);
  const close = rest.indexOf(quote[0], quote.index + quote[0].length);
  const end = rest.indexOf(";", close + quote[0].length);
  return rest.slice(0, end < 0 ? undefined : end + 1);
}

it("문장 자르기 — alter 한 줄 · 달러 따옴표 본문 뒤의 속성까지", () => {
  expect(statementAt("alter function f() security definer; select 1;", 0)).toBe("alter function f() security definer;");
  const create = "create function f() returns trigger language plpgsql as $$ begin x; end $$ security invoker; grant x;";
  expect(statementAt(create, 0)).toBe(create.slice(0, create.indexOf("; grant") + 1));
});

it("🔴 마지막으로 relink_session_receipt_allocations를 만지는 문장이 정의자 권한으로 남긴다", () => {
  // 적용 순서(시즌1 합본 구역 → 시즌2 파일) — 마지막으로 만지는 문장이 이긴다.
  let last: { file: string; statement: string } | null = null;
  for (const { name: file, sql } of migrationFiles()) {
    const body = sql.replace(/^\s*--.*$/gm, "");
    for (const hit of body.matchAll(TOUCHES)) last = { file, statement: statementAt(body, hit.index) };
  }
  expect(last, "함수 정의를 못 찾았다(이름·경로가 바뀌었나)").not.toBeNull();
  const mode = /security\s+definer/i.test(last!.statement) ? "definer" : "invoker";
  // 다시 정의했으면 그 정의에도 `security definer`를 적을 것(연동 PC 계정에 배분 표 권한을 여는 대신).
  expect(`${last!.file}: ${mode}`).toBe(`${last!.file}: definer`);
});
