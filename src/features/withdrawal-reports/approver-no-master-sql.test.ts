import { readFileSync as readFile } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readMigration, REPO_ROOT } from "@/lib/db/migrations-corpus.mjs";

/**
 * **퇴원보고서 관리자 승인자 = 관리자·매니저만**(DB 마지막 방어선 · s2_0030).
 * 원장 2026-11-05 *"관리자 승인에 '원일' 넣지 말것. 항상 '정유진' 혹은 '허은진'. 지정된 사람으로. 원장이상급은 뺴기로 했는데 자꾸 들어가있네"*,
 * 2026-11-06 *"DB도 막기"*.
 * 이 시험이 SQL 글자로 고정하는 것:
 * - s2_0030이 운영 본문(= s2_0025 본문)에서 **정해진 줄만** 바꿨다.
 * - 원장급(master)·운영자 계정이 관리자 승인자·승인 생략 작성자 자리에서 빠졌다.
 * - 원장 승인 단계·바로 처리·취소·작성 강사 자리는 그대로다.
 * - 안전장치(운영 지문 검사 · _v1 치환 횟수 검사 · 한 거래 · lock_timeout)가 **주석 밖 코드**에 기대 글자 그대로 있다
 *   (블록을 공백만 정규화해 통째로 비교 · 그 밖에 끼운 문장 없음 — 리뷰 2026-11-06 변이 시험 1·2차).
 * - 되돌리기 스크립트 = s2_0025 본문 + _v1 거꾸로 치환 · 적용 뒤 지문일 때만.
 * 동작(적용 전·후 사례 비교 · 적용 → 되돌리기 → 운영 지문)은 로컬 PGlite 0.5.8(PG 18.3)에 운영 정의를 올려 확인했다(마이그레이션 머리 주석).
 */
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const sql = lf(readMigration("s2_0030_withdrawal_approver_no_master.sql"));
const base = lf(readMigration("s2_0025_withdrawal_report_desk_refund.sql"));
const REVERT_FILE = "scripts/_oneoff/revert-s2_0030-withdrawal-approver-no-master.sql";
const revert = lf(readFile(join(REPO_ROOT, REVERT_FILE), "utf8"));
const count = (s: string, sub: string) => s.split(sub).length - 1;
const noComments = (s: string) => s.replace(/--.*$/gm, "");
const SIG = {
  request: "public.request_withdrawal_report_group(uuid,uuid,jsonb)",
  transition: "public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)",
  v1: "public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)",
} as const;
/** s2_0030 적용 전 운영 지문(2026-11-06 · 공백 뺀 md5) — 마이그레이션은 이 값일 때만 바꾸고, 되돌리기는 이 값으로 돌아왔는지 본다. */
const BEFORE = { request: "0c5f86da40dc60c05b44f00605270149", transition: "65ec57a83f8b141b85bc65a63411576f", v1: "d575408bab9253f47d3c789bc6e4c61c" } as const;
/** s2_0030 적용 뒤 지문(로컬 PGlite에서 잼 · 번호를 s2_0028에서 바꾸며 본문 주석 글자가 바뀐 요청·처리 둘은 다시 셈) — 되돌리기는 이 값일 때만 되돌린다. */
const AFTER = { request: "35afaa5ff6182c6d87d4b0b9f3a29e82", transition: "a105bba84b9630353d04729397e190d9", v1: "5a11f3fc0e920c413902ba2f137d0666" } as const;

/** 공백만 정규화(연속 공백·줄바꿈 → 한 칸) — 블록을 기대 글자와 **통째로** 비교할 때 쓴다(글자 일부 맞추기로는 예외 처리기·`where false` 같은 우회를 못 잡는다). */
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** 주석 뺀 코드에서 `do $$ … end $$;` 블록들(나온 차례). */
function doBlocks(code: string) {
  const out: string[] = [];
  for (let at = code.indexOf("do $$"); at >= 0; at = code.indexOf("do $$", at + 1)) out.push(code.slice(at, code.indexOf("end $$;", at) + "end $$;".length));
  return out;
}
/** 지문 검사 블록의 기대 글자 — 바뀌는 것은 md5 세 값과 거절 문구뿐이다. */
const guardText = (want: Record<keyof typeof SIG, string>, message: string) => [
  "do $$",
  "declare",
  "  want constant jsonb := jsonb_build_object(",
  `    '${SIG.request}', '${want.request}',`,
  `    '${SIG.transition}', '${want.transition}',`,
  `    '${SIG.v1}', '${want.v1}');`,
  "  fn text;",
  "  got text;",
  "begin",
  "  for fn in select jsonb_object_keys(want) loop",
  "    select md5(regexp_replace(pg_get_functiondef(fn::regprocedure), '[[:space:]]+', '', 'g')) into got;",
  "    if got is distinct from want->>fn then",
  `      raise exception '${message}', fn, got;`,
  "    end if;",
  "  end loop;",
  "end $$;",
].join("\n");
/** 지문 검사 블록 = 기대 글자 그대로(공백만 정규화) — 세 함수 지문을 그 값으로 보고, 다르면 예외로 멈춘다. */
function expectFingerprintGuard(block: string, want: Record<keyof typeof SIG, string>, message: string) {
  expect(squash(block)).toBe(squash(guardText(want, message)));
}
/** _v1 치환 블록의 기대 글자(짝 목록 자리는 `<PAIRS>`) — 바뀌는 것은 거절 문구뿐이다. */
const v1Text = (message: string) => [
  "do $$",
  "declare",
  "  definition text;",
  "  pairs constant text[] := array[<PAIRS>];",
  "  hits int;",
  "begin",
  `  select pg_get_functiondef('${SIG.v1}'::regprocedure) into definition;`,
  "  for i in 1 .. array_length(pairs, 1) / 2 loop",
  "    hits := (length(definition) - length(replace(definition, pairs[2*i-1], ''))) / length(pairs[2*i-1]);",
  `    if hits <> 1 then raise exception '${message}', i, hits; end if;`,
  "    definition := replace(definition, pairs[2*i-1], pairs[2*i]);",
  "  end loop;",
  "  execute definition;",
  "end $$;",
].join("\n");
/**
 * _v1 치환 블록 = 기대 글자 그대로(공백만 정규화) — 운영 정의를 읽어 짝마다 정확히 한 번인지 보고(아니면 예외) 바꾼 뒤 실행한다.
 * 짝 목록 자리는 [찾을 글자, 바꿀 글자] 짝을 그 차례 그대로 이어 쓴 것이어야 한다. 반환 = 짝(글자 그대로).
 */
function expectV1Block(block: string, from: "o" | "n", message: string, want: readonly (readonly [string, string])[]) {
  const to = from === "o" ? "n" : "o";
  const open = block.indexOf("array[") + "array[".length;
  const close = block.indexOf("];", open);
  expect(squash(block.slice(0, open) + "<PAIRS>" + block.slice(close)), "_v1 블록 뼈대").toBe(squash(v1Text(message)));
  expect(squash(block.slice(open, close)), "_v1 짝 목록").toBe(squash(want.map(([a, b]) => `$${from}$${a}$${from}$, $${to}$${b}$${to}$`).join(", ")));
  const re = new RegExp(String.raw`\$${from}\$([\s\S]*?)\$${from}\$,\s*\$${to}\$([\s\S]*?)\$${to}\$`, "g");
  return [...block.matchAll(re)].map((m) => [m[1], m[2]]);
}
/** `create or replace function public.<name>(` 부터 `$function$;`까지 — 문장 하나 통째. */
function definitionOf(code: string, name: string) {
  const start = code.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} 정의를 찾지 못함`).toBeGreaterThanOrEqual(0);
  return code.slice(start, code.indexOf("$function$;", code.indexOf("$function$", start) + "$function$".length) + "$function$;".length);
}
/**
 * 거래 하나 — 주석 뺀 코드에서 do 블록들과 함수 정의를 지우면 `begin; set local lock_timeout; set local statement_timeout; commit;`만 남는다
 * (그 밖에 끼운 문장이 없다). `begin`·`commit`은 `;` 앞 공백까지 세고(`commit\n;`), 시간 제한 설정은 각각 한 번뿐이다(뒤에서 0으로 덮어쓰지 않는다).
 */
function expectOneTransaction(code: string, pieces: readonly string[]) {
  expect(code.match(/\bbegin\s*;/gi)).toHaveLength(1);
  expect(code.match(/\bcommit\s*;/gi)).toHaveLength(1);
  expect(code.match(/\brollback\b/gi)).toBeNull();
  expect(code.match(/lock_timeout/gi)).toHaveLength(1);
  expect(code.match(/statement_timeout/gi)).toHaveLength(1);
  let rest = code;
  for (const piece of pieces) {
    expect(count(rest, piece), "지울 조각이 한 번이 아님").toBe(1);
    rest = rest.replace(piece, () => " ");
  }
  expect(squash(rest)).toBe("begin; set local lock_timeout = '5s'; set local statement_timeout = '60s'; commit;");
}
const MIGRATION_GUARD = "s2_0030: % 의 운영 정의가 기준(2026-11-06)과 다릅니다(%). 바뀐 내용을 이 파일에 옮긴 뒤 지문을 갱신하세요.";
const MIGRATION_V1 = "s2_0030: _v1의 바꿀 줄 %번이 하나가 아닙니다(%건)";
const REVERT_GUARD = "revert-s2_0030: % 의 정의가 s2_0030 적용 뒤와 다릅니다(%). 되돌리지 않습니다.";
const REVERT_V1 = "revert-s2_0030: _v1의 되돌릴 줄 %번이 하나가 아닙니다(%건)";
const REVERT_CHECK = "revert-s2_0030: 되돌린 뒤 % 의 정의가 s2_0030 적용 전 운영 지문과 다릅니다(%). 거래를 취소합니다.";

/** `create or replace function public.<name>(` 부터 그 `$function$ … $function$`까지 — 머리(시그니처·속성)와 본문. */
function fn(text: string, name: string) {
  const start = text.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} 정의를 찾지 못함`).toBeGreaterThanOrEqual(0);
  const open = text.indexOf("$function$", start);
  const close = text.indexOf("$function$", open + "$function$".length);
  return { head: text.slice(start, open), body: text.slice(open + "$function$".length, close) };
}
/** 바꾼 줄 목록을 차례로 적용(각 글자는 정확히 한 번 나와야 한다). */
function applyChanges(body: string, changes: readonly (readonly [string, string])[]) {
  for (const [before, after] of changes) {
    expect(count(body, before), `바꿀 글자가 한 번이 아님: ${before.slice(0, 80)}`).toBe(1);
    body = body.replace(before, () => after);
  }
  return body;
}
/** 줄 주석을 빼고, 허용한 자리(각 한 번)를 지운 뒤에도 'master'가 남으면 새 자리가 생긴 것이다. */
function masterLeft(body: string, allowed: readonly string[]) {
  let rest = body.replace(/^\s*--.*$/gm, "");
  for (const a of allowed) {
    expect(count(rest, a), `허용 자리가 한 번이 아님: ${a}`).toBe(1);
    rest = rest.replace(a, "");
  }
  return rest.match(/.{0,60}master.{0,60}/g) ?? [];
}

/** 운영 본문 → s2_0030 — 작성 요청(머리 주석 ①②③ + 설명 주석). */
const REQUEST = [
  ["  -- 새 화면: 보고서(작성 강사)마다 승인 관리자. 빈 목록 = 관리자 승인 생략 — 그 작성 강사가 관리자급(운영자 계정 아님)일 때만.",
   "  -- 새 화면: 보고서(작성 강사)마다 승인 관리자. 빈 목록 = 관리자 승인 생략 — 그 작성 강사가 관리자·매니저(원장급·운영자 계정 아님)일 때만(s2_0030)."],
  ["system_role::text in ('admin','manager','master') and not coalesce(public.is_super_admin(id),false)) then raise exception '승인할 관리자를 선택해 주세요.'; end if;",
   "system_role::text in ('admin','manager') and not coalesce(public.is_super_admin(id),false)) then raise exception '승인할 관리자를 선택해 주세요.'; end if;"],
  [" if exists(select 1 from unnest(managers) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager','master') and not coalesce(public.is_super_admin(id),false))) then raise exception '현재 재직 중인 승인 관리자를 선택해 주세요.'; end if;",
   " -- 승인 관리자 = 관리자·매니저만 — 원장급(master · 운영자 계정 포함)은 관리자 승인자가 아니다(원장 2026-11-05 · s2_0030). 알아보게 따로 거절한다.\n" +
   " if exists(select 1 from unnest(managers) x join public.users u on u.id=x where u.tenant_id=p_tenant and (u.system_role::text='master' or coalesce(public.is_super_admin(u.id),false))) then raise exception '원장급은 관리자 승인자로 지정할 수 없습니다. 학원 설정의 퇴원보고서 승인자를 골라 주세요.'; end if;\n" +
   " if exists(select 1 from unnest(managers) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager') and not coalesce(public.is_super_admin(id),false))) then raise exception '현재 재직 중인 승인 관리자를 선택해 주세요.'; end if;"],
] as const;

/** 운영 본문 → s2_0030 — 처리 함수(머리 주석 ④⑤⑥ + 설명 주석). */
const TRANSITION = [
  ["p_actor=any(mgrs) and not r.manager_decisions ? p_actor::text and actor.system_role::text in ('admin','manager','master')) or",
   "p_actor=any(mgrs) and not r.manager_decisions ? p_actor::text and actor.system_role::text in ('admin','manager') and not coalesce(public.is_super_admin(actor.id),false)) or"],
  ["   and not exists(select 1 from public.withdrawal_reports q, unnest(coalesce(q.manager_ids,g.manager_ids)) x where q.group_id=g.id and not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager','master')))",
   "   -- 승인 관리자는 관리자·매니저(원장급·운영자 계정 아님 · s2_0030). 바로 처리 보고서는 처리한 사람이 승인 칸이라 종전대로 둔다(원장·운영자 바로 처리 그대로).\n" +
   "   and not exists(select 1 from public.withdrawal_reports q, unnest(coalesce(q.manager_ids,g.manager_ids)) x where q.group_id=g.id and not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager','master') and (q.direct or (system_role::text<>'master' and not coalesce(public.is_super_admin(id),false)))))"],
  ["   -- 관리자 승인을 생략한 보고서는 작성 강사가 승인자 몫이다 — 아직 관리자급인지 본다.",
   "   -- 관리자 승인을 생략한 보고서는 작성 강사가 승인자 몫이다 — 아직 관리자·매니저(원장급·운영자 계정 아님)인지 본다(요청 때와 같은 조건 · s2_0030)."],
  ["cardinality(coalesce(q.manager_ids,g.manager_ids))=0 and not exists(select 1 from public.users where id=q.teacher_id and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager','master')));",
   "cardinality(coalesce(q.manager_ids,g.manager_ids))=0 and not exists(select 1 from public.users where id=q.teacher_id and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager') and not coalesce(public.is_super_admin(id),false)));"],
] as const;

/** 옛 단건(_v1) — 운영 정의에서 치환하는 세 줄(머리 주석 ⑦⑧⑨). [바꾸기 전, 바꾼 뒤]. */
const V1 = [
  ["system_role::text in ('manager','admin','master') and not coalesce(public.is_super_admin(id),false)) then raise exception '승인할 관리자를 지정해 주세요.'",
   "system_role::text in ('manager','admin') and not coalesce(public.is_super_admin(id),false)) then raise exception '승인할 관리자를 지정해 주세요.'"],
  ["(r.status='manager_pending' and r.manager_id=p_actor and actor.system_role::text in ('admin','manager','master')) or",
   "(r.status='manager_pending' and r.manager_id=p_actor and actor.system_role::text in ('admin','manager') and not coalesce(public.is_super_admin(actor.id),false)) or"],
  ["not exists(select 1 from public.users where id=r.manager_id and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager','master')) or",
   "not exists(select 1 from public.users where id=r.manager_id and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager') and not coalesce(public.is_super_admin(id),false)) or"],
] as const;

describe("퇴원보고서 관리자 승인자에서 원장급을 뺀다(s2_0030)", () => {
  it("🔴 운영 본문에서 정해진 줄만 바꿨다 — 요청·처리 함수 본문 = s2_0025 본문 + 바꾼 줄 목록(글자 그대로) · 머리(시그니처·속성) 그대로", () => {
    for (const [name, changes] of [["request_withdrawal_report_group", REQUEST], ["transition_withdrawal_report", TRANSITION]] as const) {
      const before = fn(base, name), after = fn(sql, name);
      expect(after.body, name).toBe(applyChanges(before.body, changes));
      expect(after.head.replace(/\s+/g, " "), name).toBe(before.head.replace(/\s+/g, " "));
    }
  });

  it("작성 요청 — 승인 관리자와 생략 작성자는 admin·manager(운영자 아님) · 원장급은 따로 거절 · master는 요청자·과목 범위·작성 강사 자리에만", () => {
    const { body } = fn(sql, "request_withdrawal_report_group");
    expect(count(body, "system_role::text in ('admin','manager') and not coalesce(public.is_super_admin(id),false)")).toBe(2);
    expect(body).not.toContain("('admin','manager','master')");
    expect(body).toContain("raise exception '원장급은 관리자 승인자로 지정할 수 없습니다.");
    expect(masterLeft(body, [
      "actor.system_role::text not in ('master','admin','manager')", // 작성 요청자(원장도 요청한다)
      "actor.system_role::text<>'master'", // 원장은 과목 범위 밖
      "system_role::text in ('teacher','admin','manager','master')", // 작성 강사(원장도 수업을 맡으면 작성한다)
      "u.system_role::text='master'", // 원장급 승인자 거절
    ])).toEqual([]);
  });

  it("처리 함수 — 관리자 차례·최종 재검사는 admin·manager(운영자 아님) · 바로 처리·원장 승인 단계·취소·작성 강사는 그대로", () => {
    const { body } = fn(sql, "transition_withdrawal_report");
    expect(body).toContain("actor.system_role::text in ('admin','manager') and not coalesce(public.is_super_admin(actor.id),false)) or (r.status='director_pending'");
    expect(body).toContain("system_role::text in ('admin','manager') and not coalesce(public.is_super_admin(id),false)));");
    expect(masterLeft(body, [
      // 최종 재검사의 승인 관리자 — 바로 처리(direct)만 종전대로(원장·운영자가 처리한 바로 처리는 승인 칸이 본인이다).
      "system_role::text in ('admin','manager','master') and (q.direct or (system_role::text<>'master' and not coalesce(public.is_super_admin(id),false)))",
      "actor.system_role::text='master' and not coalesce(public.is_super_admin(actor.id),false)", // 원장 승인 단계(그대로)
      "u.system_role::text='master')) or g.status in ('completed','canceled')", // 원장 취소(그대로)
      "system_role::text='master' and not coalesce(public.is_super_admin(id),false)))", // 원장 승인 단계 재검사(그대로)
      "system_role::text in ('teacher','admin','manager','master')", // 작성 강사(그대로)
    ])).toEqual([]);
  });

  it("옛 단건(_v1) — 주석 밖 코드에서 운영 정의의 세 줄만 정확히 한 번씩 치환하고(아니면 예외) 실행한다 · 바꾼 뒤 글자에 master가 없다", () => {
    const blocks = doBlocks(noComments(sql));
    expect(blocks).toHaveLength(2); // 지문 검사 · _v1 치환(되돌리기 SQL은 이 파일에 붙이지 않는다)
    expect(expectV1Block(blocks[1]!, "o", MIGRATION_V1, V1)).toEqual(V1.map(([before, after]) => [before, after]));
    for (const [before, after] of V1) {
      expect(before).toContain("master");
      expect(after).not.toContain("master");
      // 원장 승인 단계·취소 줄은 치환 대상이 아니다.
      expect(before).not.toMatch(/director|requested_by/);
    }
  });

  it("🔴 안전장치는 주석 밖에 있다 — 지문 검사 블록은 기대 글자 그대로(운영 지문이 다르면 예외로 멈춤) · 거래 하나 · 끼운 문장 없음 · lock_timeout 한 번", () => {
    const code = noComments(sql);
    const blocks = doBlocks(code);
    expectFingerprintGuard(blocks[0]!, BEFORE, MIGRATION_GUARD);
    expect(code.indexOf(blocks[0]!)).toBeLessThan(code.indexOf("create or replace function"));
    expect(code.indexOf(blocks[1]!)).toBeGreaterThan(code.indexOf(definitionOf(code, "transition_withdrawal_report")));
    expectOneTransaction(code, [...blocks, definitionOf(code, "request_withdrawal_report_group"), definitionOf(code, "transition_withdrawal_report")]);
    // 적용 뒤 지문은 머리 주석에 적어 둔다(적용 확인 · 되돌리기 검사와 같은 값).
    for (const v of Object.values(AFTER)) expect(sql).toContain(v);
    expect(sql).toContain(`되돌리기 = ${REVERT_FILE}`);
  });

  it("권한·보안·다른 함수는 그대로 — GRANT/REVOKE·SECURITY DEFINER·DROP 없음 · 바로 처리 재정의 없음 · 만드는 함수는 둘뿐", () => {
    const code = noComments(sql);
    expect(code).not.toMatch(/\b(grant|revoke)\b/i);
    expect(code).not.toMatch(/security\s+definer/i);
    expect(code).not.toMatch(/\b(drop|alter)\s+function\b/i);
    expect(code).not.toMatch(/function\s+public\.direct_withdrawal_report/i);
    expect(code.match(/create\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\(/gi)).toEqual([
      "create or replace function public.request_withdrawal_report_group(",
      "create or replace function public.transition_withdrawal_report(",
    ]);
  });

  it("되돌리기 스크립트 — 적용 뒤 지문일 때만 · s2_0025 본문 그대로 · _v1 거꾸로 치환 · 되돌린 뒤 운영 지문 확인 · 거래 하나", () => {
    const code = noComments(revert);
    const blocks = doBlocks(code);
    expect(blocks).toHaveLength(3); // 적용 뒤 지문 검사 · _v1 거꾸로 · 운영 지문 확인
    expectFingerprintGuard(blocks[0]!, AFTER, REVERT_GUARD);
    expect(code.indexOf(blocks[0]!)).toBeLessThan(code.indexOf("create or replace function"));
    for (const name of ["request_withdrawal_report_group", "transition_withdrawal_report"] as const) {
      const before = fn(base, name), restored = fn(revert, name);
      expect(restored.body, name).toBe(before.body);
      expect(restored.head.replace(/\s+/g, " "), name).toBe(before.head.replace(/\s+/g, " "));
    }
    const backwards = V1.map(([before, after]) => [after, before] as const);
    expect(expectV1Block(blocks[1]!, "n", REVERT_V1, backwards)).toEqual(backwards.map(([a, b]) => [a, b]));
    expect(code.indexOf(blocks[1]!)).toBeGreaterThan(code.indexOf(definitionOf(code, "transition_withdrawal_report")));
    expectFingerprintGuard(blocks[2]!, BEFORE, REVERT_CHECK);
    expect(code.indexOf(blocks[2]!)).toBeGreaterThan(code.indexOf(blocks[1]!));
    expectOneTransaction(code, [...blocks, definitionOf(code, "request_withdrawal_report_group"), definitionOf(code, "transition_withdrawal_report")]);
    expect(code).not.toMatch(/\b(grant|revoke)\b/i);
    expect(code).not.toMatch(/security\s+definer/i);
    expect(code).not.toMatch(/\b(drop|alter)\s+function\b/i);
    expect(code.match(/create\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\(/gi)).toEqual([
      "create or replace function public.request_withdrawal_report_group(",
      "create or replace function public.transition_withdrawal_report(",
    ]);
  });
});
