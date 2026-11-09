import { readFileSync as readFile } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readMigration, REPO_ROOT } from "@/lib/db/migrations-corpus.mjs";
import { LINE_KEY } from "./refund-keys";
import { SPECIAL_ACCESS_ID_LISTS } from "@/features/owner/settings-types";

/**
 * **원장 환불 결정 전에는 처리하지 않는다**(원장 2026-11-06 · s2_0036) — SQL 글자 가드.
 * 이 시험이 글자로 고정하는 것:
 * - 처리 함수 본문 = s2_0030 본문 + 정해진 일곱 자리(선언 · apply · release · 취소 사유 · 자식 이력 · 전원 승인 · 끝난 묶음 표시 내림)만 바꿈 · 머리 그대로.
 * - 취소 사유(원장 2026-11-06): 있으면 1~500자 검사 · 묶음 모든 보고서의 cancel 이력에 · last_comment는 그대로 · 없으면 종전대로(옛 앱).
 * - 🔴 처리하는 세 자리(전원 승인 · apply · release) 모두 '그 요청의 환불 확인 값으로 센 결정 안 된 줄(refund_open)이 0이 아니면 처리하지 않음'이
 *   처리 갈래보다 앞에 있다(refund_open이 null = 확인 값 없음도 막힌다 — `is distinct from 0`).
 * - release 함수는 확인 값이 없으면 빈 결과 · 확인 값이 있는 묶음만 · 결정 안 된 줄 0 · 데스크 환불 끝일 때만 'release'.
 * - 데스크 연결은 원장급만 · 학원 설정 데스크 명단(withdrawalDeskIds)에 있는 사람만 · null 거절. 결정 함수는 원장급만.
 * - 이어진 요청서 트리거(리뷰 r2 — INSERT·UPDATE·DELETE 한 함수 · DELETE 갈래 맨 앞 return OLD · 23514 · 수정·완료·비우기·지우기·상한) · 옛 단건(_v1)·할 일 동기화 치환(정확히 한 번).
 * - r2: 겹침 규칙(withdrawal_refund_keys_overlap — 사례표는 refund-keys.test와 PGlite) · 결정 표 paid_seen·supersedes · 내용 지문 asOf · attach 9인자 · 관문 표식 함수.
 * - 안전장치(지문 검사 · 한 거래 · lock_timeout) · 권한(REVOKE/GRANT) · 되돌리기 스크립트(적용 뒤 지문 · 진행 중 대기 멈춤 · 본문 그대로 · 거꾸로 치환).
 * 동작은 로컬 PGlite(운영 정의 · 운영 지문 일치)에서 경로별 21개 사례와 되돌리기 왕복으로 확인했다(마이그레이션 머리말).
 */
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const sql = lf(readMigration("s2_0036_withdrawal_refund_decision_gate.sql"));
const base = lf(readMigration("s2_0030_withdrawal_approver_no_master.sql"));
const s25 = lf(readMigration("s2_0025_withdrawal_report_desk_refund.sql"));
const REVERT_FILE = "scripts/_oneoff/revert-s2_0036-withdrawal-refund-decision-gate.sql";
const revert = lf(readFile(join(REPO_ROOT, REVERT_FILE), "utf8"));
const count = (s: string, sub: string) => s.split(sub).length - 1;
const noComments = (s: string) => s.replace(/^\s*--.*$/gm, "");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** s2_0036 적용 전 지문(= s2_0030 적용 뒤 · 공백 뺀 md5) — 마이그레이션은 이 값일 때만 바꾸고, 되돌리기는 이 값으로 돌아왔는지 본다. */
const BEFORE = {
  "public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)": "a105bba84b9630353d04729397e190d9",
  "public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)": "5a11f3fc0e920c413902ba2f137d0666",
  "public.attach_withdrawal_report_refund(uuid,uuid,uuid,uuid,uuid,boolean)": "846a34cb47bf901eb959c3e51f2b87e5",
  "public.release_withdrawal_report_refunds(uuid,uuid,uuid)": "b03844a446c9db506fef5669c552c187",
  "staff_tasks_private.withdrawal_sync_report(uuid)": "a8a0fb1aa5b897ff1eac199a33b03a5f",
  // r2 — 완료일자 빈칸 규칙(D-11)으로 바꾸는 데스크 환불 미완료 판정(s2_0025 본문 · 운영 지문 2026-11-09 읽기 전용 확인 = 같음).
  "public.withdrawal_report_refund_pending(uuid)": "e0eab20d959cd68364cd4a7c349385cd",
  // r3 — 빈칸 판정을 바꾸는 할 일 닫기(s2_0011)·취소 알림(s2_0025) · 운영 지문 2026-11-09 읽기 전용 확인 = 같음(PGlite 운영 정의도 같은 값).
  "staff_tasks_private.tg_refund_task()": "7ba5b00c225d849f5368182b8ffaee06",
  "public.withdrawal_report_refunds_on_cancel(uuid,uuid,uuid,text)": "9e3981d9e2cb7e319c308adf193efbbe",
} as const;
/** s2_0036 적용 뒤 지문(로컬 PGlite · r3) — 되돌리기는 이 값일 때만 되돌린다. */
const AFTER = {
  "public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)": "99c4175fd9f02dab3091086f456890b1",
  "public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)": "c8d87498a853195d7c86de12b21ae6d8",
  "public.attach_withdrawal_report_refund(uuid,uuid,uuid,uuid,uuid,boolean,jsonb,jsonb,jsonb)": "f87f992c7ce096a2e5c1dd44c278ce39",
  "public.release_withdrawal_report_refunds(uuid,uuid,uuid,jsonb)": "2516d0340b850c14faa4f91e9ea673ca",
  "staff_tasks_private.withdrawal_sync_report(uuid)": "577ba3f3c9f2c429b051b8656a660cb0",
  "public.withdrawal_report_refund_note(uuid,uuid,jsonb,uuid,boolean)": "dce627cbb631b2160ebd8d74b7a46384",
  "public.decide_withdrawal_report_refund(uuid,uuid,uuid,jsonb,jsonb,jsonb)": "7da06d12497b76d8d11fd846d5d31e43",
  "public.withdrawal_report_refund_complete_guard()": "690c049376af96d280680c168c20199c",
  "public.withdrawal_report_refund_pending(uuid)": "8950ddbc8a25c4229996235e12a2593e",
  "staff_tasks_private.tg_refund_task()": "25ac92f780f3741fd98f82a8d6eeee5f",
  "public.withdrawal_report_refunds_on_cancel(uuid,uuid,uuid,text)": "bc3ed5062ec278a6f015635c7d098e4d",
} as const;

/** 지문 검사 블록 기대 글자. */
const guardText = (want: Record<string, string>, message: string) => [
  "do $$", "declare", "  want constant jsonb := jsonb_build_object(",
  Object.entries(want).map(([k, v]) => `    '${k}', '${v}'`).join(",\n") + ");",
  "  fn text;", "  got text;", "begin",
  "  for fn in select jsonb_object_keys(want) loop",
  "    select md5(regexp_replace(pg_get_functiondef(fn::regprocedure), '[[:space:]]+', '', 'g')) into got;",
  "    if got is distinct from want->>fn then",
  `      raise exception '${message}', fn, got;`,
  "    end if;", "  end loop;", "end $$;",
].join("\n");
/** 주석 뺀 코드에서 `do $$ … end $$;` 블록들(나온 차례). */
function doBlocks(code: string) {
  const out: string[] = [];
  for (let at = code.indexOf("do $$"); at >= 0; at = code.indexOf("do $$", at + 1)) out.push(code.slice(at, code.indexOf("end $$;", at) + "end $$;".length));
  return out;
}
/** `create or replace function public.<name>(` ~ `$function$;`(처리 함수 모양) — 머리와 본문. */
function fn(text: string, name: string) {
  const start = text.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} 정의를 찾지 못함`).toBeGreaterThanOrEqual(0);
  const open = text.indexOf("$function$", start);
  const close = text.indexOf("$function$", open + "$function$".length);
  return { head: text.slice(start, open), body: text.slice(open + "$function$".length, close), whole: text.slice(start, close + "$function$;".length) };
}
/** `create [or replace] function public.<name>(` ~ `end $$;`(새 함수 모양 · $$ 본문). */
function dollarFn(text: string, name: string) {
  const re = new RegExp(`create (or replace )?function public\\.${name}\\(`);
  const start = text.search(re);
  expect(start, `${name} 정의를 찾지 못함`).toBeGreaterThanOrEqual(0);
  return text.slice(start, text.indexOf("end $$;", start) + "end $$;".length);
}
function applyChanges(body: string, changes: readonly (readonly [string, string])[]) {
  for (const [before, after] of changes) {
    expect(count(body, before), `바꿀 글자가 한 번이 아님: ${before.slice(0, 80)}`).toBe(1);
    body = body.replace(before, () => after);
  }
  return body;
}
/** 치환 블록의 짝 — [찾을 글자, 바꿀 글자](글자 그대로). */
function pairsOf(block: string, from: "o" | "n") {
  const to = from === "o" ? "n" : "o";
  const re = new RegExp(String.raw`\$${from}\$([\s\S]*?)\$${from}\$,\s*\$${to}\$([\s\S]*?)\$${to}\$`, "g");
  return [...block.matchAll(re)].map((x) => [x[1]!, x[2]!] as const);
}
/** s2_0030 처리 함수 본문 → s2_0036(마이그레이션 생성에 쓴 목록과 같은 글자). */
const TRANSITION: readonly (readonly [string, string])[] = [
  [" field text; child public.withdrawal_reports; valid boolean; targets uuid[]; affected integer; cmp_subjects text[]; all_approved boolean; mgrs uuid[];",
   " field text; child public.withdrawal_reports; valid boolean; targets uuid[]; affected integer; cmp_subjects text[]; all_approved boolean; mgrs uuid[];\n -- 결정하지 않은 환불 가능 줄 수(s2_0036 · withdrawal_report_refund_note) — null = 앱이 환불 확인 값을 넘기지 않음(모름 → 처리하지 않는다).\n refund_open integer;"],
  ["  -- 데스크 환불이 남은 예약은 처리일이 돼도 미룬다 — 오류 없이 그대로 돌려준다(앱 cron이 '미룸'으로 세고 다음 날 다시 · 환불 완료 때 release).\n  if public.withdrawal_report_refund_pending(g.id) then return r; end if;",
   "  -- 환불 결정(s2_0036 · 원장 2026-11-06) — 앱이 같은 요청에서 계산한 환불 가능 줄(refundCheck)로 '환불 결정 대기'를 맞춘다.\n  refund_open:=public.withdrawal_report_refund_note(p_tenant,g.id,p_payload->'refundCheck',p_actor);\n  -- 데스크 환불이 남았거나 · 원장이 결정하지 않은 환불 가능 줄이 있거나 · 환불 확인 값이 없으면(옛 앱 · 계산 빠뜨림) 처리일이 돼도 미룬다 —\n  -- 오류 없이 그대로 돌려준다(앱 cron이 '미룸'으로 세고 다음 날 다시 · 원장 결정·환불 완료 때 release).\n  if public.withdrawal_report_refund_pending(g.id) or refund_open is distinct from 0 then return r; end if;"],
  ["or (g.status='scheduled' and g.effective_date<=today)) then raise exception '데스크 환불이 끝난 승인 완료 보고서만 처리할 수 있습니다.'; end if;",
   "or (g.status='scheduled' and g.effective_date<=today)) then raise exception '데스크 환불이 끝난 승인 완료 보고서만 처리할 수 있습니다.'; end if;\n  -- 환불 결정(s2_0036) — 결정하지 않은 환불 가능 줄이 있거나 환불 확인 값이 없으면(직접 호출 포함) 처리하지 않고 그대로 돌려준다(표시는 남는다).\n  refund_open:=public.withdrawal_report_refund_note(p_tenant,g.id,p_payload->'refundCheck',p_actor);\n  if refund_open is distinct from 0 then return r; end if;"],
  [" if all_approved and public.withdrawal_report_refund_pending(g.id) then\n  -- 승인은 모두 끝났고 데스크 환불만 남았다 — 묶음은 기다린다(원장 2026-11-03 '데스크 환불 요청' 단계). 환불 완료 때 release가 처리한다.\n  recipients:=array[r.teacher_id,g.requested_by]; headline:='퇴원보고서 데스크 환불 요청';",
   " -- 환불 결정(s2_0036) — 제출·승인 때 앱이 넘긴 환불 확인으로 '환불 결정 대기'를 맞춘다(원장에게 미리 알린다). 전원 승인이면 이 값으로 처리 여부를 정한다.\n if p_action in ('submit','approve') and g.status='pending' then refund_open:=public.withdrawal_report_refund_note(p_tenant,g.id,p_payload->'refundCheck',p_actor); end if;\n if all_approved and (public.withdrawal_report_refund_pending(g.id) or refund_open is distinct from 0) then\n  -- 승인은 모두 끝났고 환불 결정·데스크 환불이 남았다 — 묶음은 기다린다(원장 2026-11-03 '데스크 환불 요청' · 2026-11-06 '환불 결정 대기').\n  -- 원장 결정·환불 완료 때 release가 처리한다. 환불 확인 값이 없으면(옛 앱 · 계산 빠뜨림) 처리하지 않고 다음 확인(처리일 cron)을 기다린다.\n  recipients:=array[r.teacher_id,g.requested_by];\n  headline:=case when refund_open>0 then '퇴원보고서 환불 결정 대기' when public.withdrawal_report_refund_pending(g.id) then '퇴원보고서 데스크 환불 요청' else '퇴원보고서 승인 완료 · 처리 확인 대기' end;"],
  ["  g.status:='canceled'; headline:='퇴원보고서 요청 취소';",
   "  -- 취소 사유(원장 2026-11-06 · s2_0036) — 있으면 앞뒤 공백을 빼고 1~500자(공백·줄바꿈·탭만이면 거절 · 리뷰 #11) · 묶음의 모든 보고서 이력 'cancel' 줄에 같은 사유가 남는다(아래 반복).\n  -- 없으면(옛 앱) 종전처럼 사유 없이 취소한다 — 필수 여부는 앱이 정한다.\n  if p_payload->>'comment' is not null then\n   comment_text:=btrim(p_payload->>'comment');\n   if char_length(comment_text) not between 1 and 500 or comment_text !~ '[^[:space:]]' then raise exception '취소 사유를 1~500자로 작성해 주세요.'; end if;\n  end if;\n  g.status:='canceled'; headline:='퇴원보고서 요청 취소';"],
  ["   update public.withdrawal_reports set status=g.status,applied_at=g.applied_at,last_comment=coalesce(comment_text,last_comment),revision=revision+1,updated_at=now() where id=child.id;",
   "   -- 취소 사유는 이력에만 남긴다(last_comment = 반려 사유·재검토 안내 칸 — 상세의 안내 상자로 읽히지 않게 · s2_0036).\n   update public.withdrawal_reports set status=g.status,applied_at=g.applied_at,last_comment=coalesce(case when p_action='cancel' then null else comment_text end,last_comment),revision=revision+1,updated_at=now() where id=child.id;"],
  ["  update public.withdrawal_report_groups set status=g.status,applied_at=g.applied_at where id=g.id;",
   "  -- 끝난 묶음(처리 예약 밖 · 처리 완료·재검토·취소)엔 기다릴 환불 결정이 없다 — 표시를 내린다(s2_0036).\n  update public.withdrawal_report_groups set status=g.status,applied_at=g.applied_at,refund_hold=refund_hold and g.status in ('pending','scheduled') where id=g.id;"],
];

describe("원장 환불 결정 전에는 처리하지 않는다(s2_0036)", () => {
  it("🔴 처리 함수 = s2_0030 본문 + 정해진 일곱 자리만(글자 그대로) · 머리(시그니처·속성) 그대로", () => {
    const before = fn(base, "transition_withdrawal_report"), after = fn(sql, "transition_withdrawal_report");
    expect(after.body).toBe(applyChanges(before.body, TRANSITION));
    expect(after.head.replace(/\s+/g, " ")).toBe(before.head.replace(/\s+/g, " "));
  });

  it("🔴 처리하는 세 자리 모두 — 확인 값으로 센 결정 안 된 줄(null 포함)이 0이 아니면 처리 갈래 앞에서 멈춘다", () => {
    const body = fn(sql, "transition_withdrawal_report").body;
    const note = "public.withdrawal_report_refund_note(p_tenant,g.id,p_payload->'refundCheck',p_actor)";
    expect(count(body, note)).toBe(3);
    const processing = body.indexOf(" elsif all_approved or p_action in ('apply','release') then");
    expect(count(body, " elsif all_approved or p_action in ('apply','release') then")).toBe(1);
    // apply 갈래 — 미룸(그대로 돌려줌)이 처리 갈래보다 앞.
    const apply = body.slice(body.indexOf(" elsif p_action='apply' then"), body.indexOf(" elsif p_action='release' then"));
    expect(apply).toContain(`  refund_open:=${note};`);
    expect(apply).toContain("  if public.withdrawal_report_refund_pending(g.id) or refund_open is distinct from 0 then return r; end if;");
    // release 갈래 — 데스크 대기·승인 미완료는 거절, 결정 안 됨·확인 값 없음은 그대로 돌려줌.
    const release = body.slice(body.indexOf(" elsif p_action='release' then"), body.indexOf(" update public.withdrawal_reports set body=r.body"));
    expect(release).toContain(`  refund_open:=${note};\n  if refund_open is distinct from 0 then return r; end if;`);
    expect(release.indexOf("then raise exception '데스크 환불이 끝난 승인 완료 보고서만 처리할 수 있습니다.'")).toBeLessThan(release.indexOf("refund_open:="));
    // 전원 승인 — 제출·승인 때 센 값으로 기다림(처리 갈래 바로 앞 조건).
    const wait = " if all_approved and (public.withdrawal_report_refund_pending(g.id) or refund_open is distinct from 0) then";
    expect(count(body, wait)).toBe(1);
    expect(body.indexOf(wait)).toBeLessThan(processing);
    expect(body).toContain(` if p_action in ('submit','approve') and g.status='pending' then refund_open:=${note}; end if;\n${wait}`);
    // 학생을 퇴원으로 쓰는 곳은 처리 갈래 한 군데(그 앞에 세 가드).
    expect(body.match(/update public\.students set status='withdrawn'/g)).toHaveLength(1);
    expect(body.indexOf("update public.students set status='withdrawn'")).toBeGreaterThan(processing);
    // 결정 대기 표시는 끝난 묶음에서 내린다.
    expect(body).toContain("update public.withdrawal_report_groups set status=g.status,applied_at=g.applied_at,refund_hold=refund_hold and g.status in ('pending','scheduled') where id=g.id;");
  });

  it("취소 사유 — 있으면 앞뒤 공백 빼고 1~500자 · 묶음 모든 보고서의 cancel 이력(comment_text) · 반려 사유 칸은 그대로 · 없으면 종전(옛 앱)", () => {
    const body = fn(sql, "transition_withdrawal_report").body;
    const cancel = body.slice(body.indexOf(" elsif p_action='cancel' then"), body.indexOf(" elsif p_action='apply' then"));
    expect(cancel).toContain("  if p_payload->>'comment' is not null then\n   comment_text:=btrim(p_payload->>'comment');\n   if char_length(comment_text) not between 1 and 500 or comment_text !~ '[^[:space:]]' then raise exception '취소 사유를 1~500자로 작성해 주세요.'; end if;\n  end if;");
    expect(cancel.indexOf("comment_text:=btrim")).toBeGreaterThan(cancel.indexOf("raise exception '이 요청을 취소할 수 없습니다.'"));  // 권한 검사 뒤
    // 자식 반복 — 이력 줄은 comment_text(취소 사유) · last_comment는 취소 때 그대로.
    expect(body).toContain("insert into public.withdrawal_report_events(tenant_id,report_id,actor_id,action,from_status,to_status,comment) values(p_tenant,child.id,p_actor,p_action,child.status,g.status,comment_text);");
    expect(body).toContain("last_comment=coalesce(case when p_action='cancel' then null else comment_text end,last_comment)");
    // 알림 본문에는 사유를 싣지 않는다(이름 · 마지막 수업일만 — 반려와 같은 규칙).
    expect(body).not.toMatch(/notifications[^;]*comment_text/);
  });

  it("결정 안 됨 판정·표시 — 확인 값 없으면 null(모름) · '환불하지 않음'과 남은 요청서의 '환불'만 결정됨 · 알림은 원장급(운영자 계정·행위자 제외) · 처리 전 묶음만", () => {
    const note = noComments(dollarFn(sql, "withdrawal_report_refund_note"));
    expect(note).toContain("security invoker");
    expect(note).toContain("if p_check is null or jsonb_typeof(p_check) is distinct from 'object' then return null; end if;");
    expect(note).toContain("and (d.decision = 'none' or exists(select 1 from public.academy_documents doc where doc.tenant_id = p_tenant and doc.id = d.document_id and doc.form_type = 'refund_request'))");
    expect(note).toContain("if g.status not in ('pending', 'scheduled') then");
    // 🔴 묶음 경계(팀장 결정 2026-11-06) — 결정은 이 묶음 것만 센다(다른 묶음 · 취소된 요청의 '환불' 결정·요청서는 이 묶음에서 결정이 아니다)
    expect(note).toContain("where d.tenant_id = p_tenant and d.group_id = g.id and d.line_key = l.k");
    // 연결 표는 claimed(이 묶음 요청서가 잡은 줄) 확인에만 — 이 묶음(g.id)에 이어진 요청서만 본다(다른 묶음의 요청서는 결정이 아니다) · ①(그 요청서·같은 청구) ③(결정 행 없음 → 표식에 정확히) 두 자리.
    expect(note.match(/withdrawal_report_refunds/g)).toHaveLength(2);
    expect(count(note, "join public.withdrawal_report_refunds f on f.tenant_id = a.tenant_id and f.document_id = a.id and f.group_id = g.id")).toBe(2);
    expect(note).toContain("from jsonb_array_elements(p_check->'claimed') with ordinality x(e, ord)\n     where not exists(select 1 from public.academy_documents a");
    // ① 같은 청구를 담은 이 묶음 요청서(낡은 표식·형제로 넓힌 줄도 — 리뷰 r2 D-2)
    expect(note).toContain("where lower(split_part(t, '#', 1)) = lower(split_part(e->>'key', '#', 1))))");
    // ② 결정 행이 있으면 본 낸 돈보다 지금이 크면 결정 안 됨('환불' 결정도 — 리뷰 r2 D-4)
    expect(note).toContain("and coalesce(d.paid_seen, d.paid_net) is not null and jsonb_typeof(e->'paid') = 'number' and (e->>'paid')::numeric > coalesce(d.paid_seen, d.paid_net))");
    // ③ 결정 행이 없으면 표식에 정확히 그 키(앱이 넓혀 담은 줄은 원장이 한 번 정한다)
    expect(note).toContain("or (not exists(select 1 from public.withdrawal_report_refund_decisions d where d.tenant_id = p_tenant and d.group_id = g.id and d.line_key = e->>'key'");
    // 🔴 ②·③의 결정 행은 그 요청서가 남아 있을 때만('환불하지 않음'은 그대로) — 지워진 요청서의 결정 행으로 결정됨이 되지 않게(리뷰 r3 R-5)
    expect(count(note, "and (d.decision = 'none' or exists(select 1 from public.academy_documents doc where doc.tenant_id = p_tenant and doc.id = d.document_id and doc.form_type = 'refund_request'))")).toBe(3);
    expect(note).toContain("and (e->>'key') = any(string_to_array(substring(a.description from 'lines:([^[:space:]·]+)'), ','))))");
    // 확인 값 모양(refundable[{key, report, paid}] · claimed[{key, doc}] · asOf · scope) — 하나라도 어긋나면 거절
    expect(note).toContain("or jsonb_typeof(p_check->'claimed') is distinct from 'array'");
    expect(note).toContain("or coalesce(p_check->>'scope', '') not in ('withdrawal', 'subject_end')");
    expect(note).toContain("or jsonb_typeof(e->'paid') is distinct from 'number' or (e->>'paid')::numeric < 0");
    // 🔴 낡은 확인 값(asOf = 청구 내용 지문 · 리뷰 r2 D-12) · 처리 범위(scope)가 다르면 모름(null — 처리하지 않는다)
    expect(note).toContain("if p_check->>'asOf' is distinct from public.withdrawal_refund_later_fingerprint(p_tenant, g.student_id, to_char(g.effective_date, 'YYYY-MM')) then return null; end if;");
    expect(note).not.toContain("updated_at");
    expect(sql).toContain("select md5(coalesce(string_agg(concat_ws('|', i.id, i.period, i.category, i.status, i.amount_total, i.amount_discount, i.amount_paid, i.line_items::text), ',' order by i.id), ''))");
    expect(note).toContain("if p_check->>'scope' is distinct from scope_now then return null; end if;");
    // 처리 범위 판정 = 처리 함수의 전체 퇴원 전환 조건과 같은 글자(남는 수강)
    expect(note).toContain("and c.is_active and c.closed_at is null and (e.end_date is null or e.end_date > greatest(g.effective_date, today)))");
    expect(fn(sql, "transition_withdrawal_report").body).toContain("and c.is_active and c.closed_at is null and (e.end_date is null or e.end_date>greatest(g.effective_date,today))) then g.exit_kind:='withdrawal'");
    // 결정 뒤 그 줄의 낸 돈이 늘면 다시 결정 안 됨(본 낸 돈 paid_seen — 없으면 paid_net)
    expect(note).toContain("and (coalesce(d.paid_seen, d.paid_net) is null or l.paid <= coalesce(d.paid_seen, d.paid_net)))");
    expect(note).toContain("u.system_role::text = 'master' and not coalesce(public.is_super_admin(u.id), false)");
    expect(note).toContain("and u.id is distinct from p_actor");
    expect(note).toContain("'퇴원보고서 환불 결정 요청'");
    expect(note).toContain("if n > 0 and not was then");  // 같은 대기를 다시 알리지 않는다
    expect(note).toContain("perform staff_tasks_private.withdrawal_sync_report(rid);");
    expect(note).toContain("'refund_hold'");
    expect(note).toContain("'refund_hold_clear'");
  });

  it("🔴 release 함수 — 확인 값 없으면 빈 결과(옛 3인자 호출 포함) · 확인 값이 있는 묶음만 · 결정 안 된 줄 0 · 데스크 끝 · 처리할 차례일 때만", () => {
    const rel = noComments(dollarFn(sql, "release_withdrawal_report_refunds"));
    expect(sql).toContain("drop function public.release_withdrawal_report_refunds(uuid, uuid, uuid);");
    expect(rel).toContain("create function public.release_withdrawal_report_refunds(p_tenant uuid, p_document uuid, p_actor uuid, p_checks jsonb default null)");
    expect(rel).toContain("if p_checks is null or jsonb_typeof(p_checks) is distinct from 'object' then return out; end if;");
    expect(rel).toContain("and p_checks ? g.id::text");
    expect(rel).toContain("n := public.withdrawal_report_refund_note(x.tid, x.gid, p_checks->(x.gid::text), actor);");
    expect(rel).toContain("continue when n is distinct from 0 or public.withdrawal_report_refund_pending(x.gid)");
    expect(rel).toContain("res := public.transition_withdrawal_report(x.tid, actor, x.rid, 'release', jsonb_build_object('refundCheck', p_checks->(x.gid::text)));");
    expect(rel.indexOf("continue when n is distinct from 0")).toBeLessThan(rel.indexOf("res := public.transition_withdrawal_report("));
    expect(count(rel, "transition_withdrawal_report(")).toBe(1);
  });

  it("🔴 데스크 연결 — 원장급만 · 학원 설정 데스크 명단 안의 사람만(비거나 null이면 거절) · 고른 줄 '환불' · 고르지 않은 줄 '환불하지 않음'", () => {
    const att = noComments(dollarFn(sql, "attach_withdrawal_report_refund"));
    expect(sql).toContain("drop function public.attach_withdrawal_report_refund(uuid, uuid, uuid, uuid, uuid, boolean);");
    expect(att).toContain("p_none jsonb default null, p_check jsonb default null, p_supersedes jsonb default null)");
    // 완료일자가 든 요청서는 잇지 않는다(리뷰 r2 D-6 · 빈칸 = 앱 trim과 같은 글자)
    expect(att).toContain("if not public.withdrawal_refund_blank(doc_done) then raise exception '환불완료일자가 이미 들어간 요청서는 이을 수 없습니다.");
    expect(att).toContain("id = p_actor and status = 'active' and system_role::text = 'master') then raise exception '환불 승인은 원장만 할 수 있습니다.'");
    expect(att).toContain("select ts.data #> '{permissions,specialAccess,withdrawalDeskIds}' into desks from public.tenant_settings ts where ts.tenant_id = p_tenant;");
    expect(att).toContain("if jsonb_typeof(desks) is distinct from 'array' or jsonb_array_length(desks) = 0 then raise exception '학원 설정에서 데스크 담당자를 먼저 지정해 주세요.'");
    expect(att).toContain("if p_desk is null or not (desks ? p_desk::text) then raise exception");
    expect(att).not.toContain("if p_desk is not null then");  // s2_0025의 'null이면 데스크 없이' 갈래가 없다
    expect(att).toContain("system_role::text in ('master','admin','manager','accountant')");
    expect(att).toContain("and not coalesce(public.is_super_admin(id), false) and id is distinct from p_actor;");
    expect(att).toContain("select p_tenant, gid, r.id, s.k, 'refund', p_document, p_actor, s.pv, s.pv, old_docs");
    // 다시 승인 상한 = 낸 돈 − 따로 처리하기로 한 금액 − 환불 완료 기록(원장 결정 2026-11-09 · 리뷰 r3)
    expect(att).toContain("decided_at = now(), paid_net = greatest(0, excluded.paid_net - coalesce(t.separate_amount, 0) - coalesce(t.refunded_total, 0)), paid_seen = excluded.paid_seen,");
    // 🔴 같은 묶음이어도 살아 있는 다른 요청서가 같은 키를 담았으면 거절(리뷰 r3 R-1 · P6b 이중 환불)
    expect(att).toContain("join public.withdrawal_report_refund_decisions o on o.tenant_id = p_tenant and o.group_id = gid and o.line_key = x and o.decision = 'refund' and o.document_id is distinct from p_document");
    expect(att.indexOf("o.group_id = gid and o.line_key = x")).toBeLessThan(att.indexOf("insert into public.withdrawal_report_refunds"));
    // 🔴 요청서의 첫 총액도 상한과 맞댄다(리뷰 r3 R3-1 — 상한 모름 · 못 읽음 · 넘음이면 거절 · 결정 행을 남긴 뒤 · 이벤트·표시 전)
    expect(att).toContain("select count(*) > 0 and bool_and(d.paid_net is not null), sum(d.paid_net) into cap_known, cap");
    expect(att).toContain("first_total := public.withdrawal_refund_won((select a.form_data #>> '{refund,totalAmount}' from public.academy_documents a where a.tenant_id = p_tenant and a.id = p_document));");
    expect(att).toContain("if not coalesce(cap_known, false) or first_total is null or first_total > cap then");
    expect(att.indexOf("first_total > cap")).toBeGreaterThan(att.indexOf("perform public.withdrawal_refund_record_none(p_tenant, gid, r.id, k,"));
    expect(att.indexOf("first_total > cap")).toBeLessThan(att.indexOf("insert into public.withdrawal_report_events"));
    // 머리말 '적용 확인' 줄은 6인자 decide(리뷰 r3 R3-2 — 5인자로 찾으면 바르게 적용해도 false)
    expect(sql).toContain("--   select to_regprocedure('public.decide_withdrawal_report_refund(uuid,uuid,uuid,jsonb,jsonb,jsonb)') is not null");
    // 대체 옛 요청서는 고른 줄과 같은 청구를 담은 것만(리뷰 r3 R-4)
    expect(att).toContain("then raise exception '대체할 옛 요청서가 고른 청구를 담고 있지 않습니다. 새로고침 후 다시 확인해 주세요.'; end if;");
    // 고르지 않은 줄 = 환불 가능 줄 · 다시 정할 이 묶음 요청서 줄(claimed) — '환불하지 않음' 기록은 한 함수(withdrawal_refund_record_none)
    expect(att).toContain("perform public.withdrawal_refund_record_none(p_tenant, gid, r.id, k,");
    expect(att).toContain("and not exists(select 1 from jsonb_array_elements(coalesce(p_check->'claimed', '[]'::jsonb)) e where e->>'key' = x)))");
    // 결정은 묶음 단위 — 고르지 않은 줄·고른 줄은 이 묶음 확인 값 안이면(대표 아닌 보고서 화면도 · 리뷰 #4)
    expect(att).not.toContain("lower(e->>'report') = r.id::text");
    // 🔴 원장 C.3 반대쪽 — 학생 단위 잠금 아래 · 다른 요청서가 담은 줄(환불을 마쳤거나 취소되지 않은 요청)을 고르면 거절
    expect(att).toContain("perform pg_advisory_xact_lock(hashtextextended('withdrawal_refund_lines:' || p_tenant::text || ':' || r.student_id::text, 0));");
    expect(att.indexOf("pg_advisory_xact_lock")).toBeGreaterThan(att.indexOf("for update;"));
    expect(att.indexOf("pg_advisory_xact_lock")).toBeLessThan(att.indexOf("insert into public.withdrawal_report_refunds("));
    // 🔴 같은 돈 두 번 막기(리뷰 r2 D-1 ⅱ) — 겹침 규칙 한 벌 · 다른 묶음만(같은 묶음 안 형제·과목 몫은 앱과 같이 막지 않는다)
    expect(count(att, "and o.group_id is distinct from gid and public.withdrawal_refund_keys_overlap(o.line_key, x)")).toBe(1);
    expect(att).toContain("where og.status <> 'canceled' or not public.withdrawal_refund_blank(a.form_data #>> '{result,completedDate}'))");
    expect(count(att, "then raise exception '다른 요청의 요청서가 이미 담은 건이 있습니다. 그 건은 고르지 말고(환불하지 않음) 요청서를 확인해 주세요.'; end if;")).toBe(2);
    // 대체하는 옛 요청서(리뷰 r2 D-1 ⅰ) — 넘긴 것은 '취소된 요청에만 이어진 미완료'여야 · 겹치는 것은 DB가 더한다(C.3가 문서 id로 막는다)
    expect(att).toContain("or exists(select 1 from public.withdrawal_report_refunds f join public.withdrawal_reports q on q.id = f.report_id where f.document_id = od and q.status <> 'canceled'))");
    expect(att).toContain("and o.group_id is distinct from gid and public.withdrawal_refund_keys_overlap(o.line_key, y)");
    expect(att).toContain("open_n := public.withdrawal_report_refund_note(p_tenant, gid, p_check, p_actor, true);");
    // 앱 설정 칸 이름과 같다.
    expect(SPECIAL_ACCESS_ID_LISTS).toContain("withdrawalDeskIds");
  });

  it("원장 '환불 없음' — 원장급만 · 처리 전 묶음만 · 확인 값 안의 이 보고서 줄만 · 처리는 하지 않는다", () => {
    const dec = noComments(dollarFn(sql, "decide_withdrawal_report_refund"));
    expect(dec).toContain("system_role::text = 'master') then raise exception '환불 결정은 원장만 할 수 있습니다.'");
    expect(dec).toContain("if g.status not in ('pending', 'scheduled') or r.status in ('canceled', 'completed', 'blocked') then raise exception");
    expect(dec).not.toContain("lower(e->>'report') = r.id::text");   // 대표 아닌 보고서 화면의 '환불 없음'도 받는다(리뷰 #4)
    // 환불 가능 줄 · 다시 정할 이 묶음 요청서 줄(claimed)을 받는다 — 기록은 attach와 같은 함수(리뷰 r2 D-2·D-4)
    expect(dec).toContain("and not exists(select 1 from jsonb_array_elements(coalesce(p_check->'claimed', '[]'::jsonb)) e where e->>'key' = x)))");
    expect(dec).toContain("perform public.withdrawal_refund_record_none(p_tenant, g.id, r.id, k,");
    expect(dec).toContain("'refund_decision'");
    // '환불하지 않음' 기록 — 담은 요청서가 없으면 none(paid_net = paid_seen) · 있으면 그 요청서 '환불'의 상한(paid_net)은 그대로 · 본 낸 돈만
    const none = noComments(dollarFn(sql, "withdrawal_refund_record_none"));
    expect(none).toContain("values (p_tenant, p_group, p_report, p_key, 'none', null, p_actor, p_paid, p_paid)");
    expect(none).toContain("values (p_tenant, p_group, p_report, p_key, 'refund', v_doc, p_actor, 0, p_paid)");
    expect(none).toContain("paid_net = case when t.decision = 'none' or t.document_id = v_doc then t.paid_net else 0 end,");
    expect(none).toContain("if v_doc is not null and not exists(select 1 from public.withdrawal_report_refunds f where f.tenant_id = p_tenant and f.document_id = v_doc and f.group_id = p_group) then v_doc := null; end if;");
    expect(dec).not.toMatch(/transition_withdrawal_report\(/);
  });

  it("🔴 이어진 요청서 지키기 — 완료일자는 그 데스크 담당·원장만(세션) · 번호·지점·서식·표식 변경과 같은 번호로 다시 넣기는 누구도(트리거 우회 막기)", () => {
    const g = noComments(dollarFn(sql, "withdrawal_report_refund_complete_guard"));
    expect(g).toContain("security definer set search_path = public");
    // 🔴 DELETE 갈래가 맨 앞 · 이어지지 않은 문서는 return OLD(return NEW = null이면 자료실 삭제가 조용히 0행 — 리뷰 r2 경고)
    const del = g.slice(g.indexOf("if tg_op = 'DELETE' then"), g.indexOf("if tg_op = 'INSERT' then"));
    expect(g.indexOf("if tg_op = 'DELETE' then")).toBeLessThan(g.indexOf("if tg_op = 'INSERT' then"));
    expect(del).toContain("if not coalesce(v_linked, false) then return OLD; end if;");
    expect(del).toContain("if not exists(select 1 from public.tenants t where t.id = OLD.tenant_id) then return OLD; end if;");
    expect(del).toContain("if not public.withdrawal_refund_blank(OLD.form_data #>> '{result,completedDate}') then");
    expect(del.trimEnd().endsWith("return OLD;\n  end if;")).toBe(true);
    expect(del).not.toContain("return NEW");
    expect(g).toContain("if tg_op = 'INSERT' then\n    if exists(select 1 from public.withdrawal_report_refunds f where f.document_id = NEW.id) then");
    expect(g).toContain("select true, f.desk_id into v_linked, v_desk from public.withdrawal_report_refunds f where f.document_id = OLD.id or f.document_id = NEW.id limit 1;");
    expect(g).toContain("if NEW.id is distinct from OLD.id or NEW.tenant_id is distinct from OLD.tenant_id or NEW.form_type is distinct from OLD.form_type or NEW.description is distinct from OLD.description then");
    expect(g).not.toContain("NEW.form_type is distinct from 'refund_request'");  // 서식을 바꿔 검사를 건너뛰는 갈래가 없다
    // 고치기(form_data·제목 — 완료일자 포함)는 세션이면 담당 데스크(재직)·원장 · 분류·고정·직원 연쇄는 막지 않는다(리뷰 r2 I6) · 비우기는 원장만(B1·D-13)
    expect(g).toContain("v_desk_ok := v_uid = v_desk and exists(select 1 from public.users u where u.tenant_id = NEW.tenant_id and u.id = v_desk and u.status = 'active');");
    expect(g).toContain("if (NEW.form_data is distinct from OLD.form_data or NEW.title is distinct from OLD.title) and not (v_desk_ok or v_director) then");
    expect(g).not.toMatch(/NEW\.(category|pinned|uploaded_by|staff_user_id) is distinct/);
    expect(g).toContain("if v_old_done and not v_new_done and not v_director then");
    // 상한(관리 키 포함 · 금액 칸이 바뀔 때만 · 모르면 거절)
    expect(g).toContain("select count(*) > 0 and bool_and(d.paid_net is not null), sum(d.paid_net) into v_cap_known, v_cap");
    expect(g).toContain("v_total := public.withdrawal_refund_won(NEW.form_data #>> '{refund,totalAmount}');");
    expect(g).toContain("if v_total is null then");   // 못 읽는 표기('300만원' 등)는 거절(리뷰 r3 R-2)
    expect(g).toContain("if v_total > v_cap then");
    expect(g).toContain("for v_tok in select m[1] from regexp_matches(coalesce(NEW.form_data #>> '{refund,paymentDetails}', '')");
    expect(g).toContain("if v_amt > v_cap and not exists(select 1 from regexp_matches(coalesce(OLD.form_data #>> '{refund,paymentDetails}', '')");
    // 완료일자 = 빈칸 또는 YYYY-MM-DD(리뷰 r3 R-9)
    expect(g).toContain("and (NEW.form_data #>> '{result,completedDate}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then");
    // 환불 완료 기록(완료일자가 처음 들어갈 때 · 관리 키 포함 · 요청서마다 한 번)
    expect(g).toContain("update public.withdrawal_report_refund_decisions d set refunded_total = coalesce(d.refunded_total, 0) + coalesce(d.paid_net, 0), refunded_docs = d.refunded_docs || NEW.id");
    expect(g.indexOf("refunded_total = coalesce")).toBeLessThan(g.indexOf("if v_uid is null then return NEW; end if;"));
    expect(g.indexOf("v_cap_known")).toBeLessThan(g.indexOf("if v_uid is null then return NEW; end if;"));
    // 🔴 원장 C.3 — 취소된 요청에만 이어진 요청서의 첫 완료일자 · 같은 청구 줄의 새 요청서(취소되지 않은 묶음 · 문서 남음)가 있으면 누구도(관리 키 포함) 거절
    expect(g).toContain("perform pg_advisory_xact_lock(hashtextextended('withdrawal_refund_lines:' || NEW.tenant_id::text || ':' || v_student::text, 0));");
    expect(g).toContain("raise exception using errcode = '23514', message = '같은 청구에 새 퇴원 요청의 요청서가 있습니다 — 새 요청서로 처리하세요.';");
    expect(g.indexOf("새 퇴원 요청의 요청서가 있습니다")).toBeLessThan(g.indexOf("if v_uid is null then return NEW; end if;"));   // 관리 키(auth.uid 없음)보다 먼저
    expect(g).toContain("join public.withdrawal_report_groups og on og.id = o.group_id and og.status <> 'canceled'");
    // C.3 = 새 결정 행이 이 요청서를 대체한다고 적었거나(supersedes — 키가 바뀌어도) · 겹침 규칙(리뷰 r2 D-1)
    expect(g).toContain("and (NEW.id = any(o.supersedes)");
    expect(g).toContain("public.withdrawal_refund_keys_overlap(mine.line_key, o.line_key)");
    // 🔴 오류코드는 23514뿐 — 42501이면 강사뷰 쓰기(writeSessionFirst)가 관리 키로 다시 써 이 트리거를 지난다
    expect(g).not.toContain("'42501'");
    expect(g.match(/raise exception using errcode = '23514'/g)!.length).toBeGreaterThanOrEqual(9);
    // 모든 넣기·고치기·지우기에 건다(칸을 가리면 다른 칸과 함께 바꿔 피할 수 있다).
    expect(sql).toContain("create trigger withdrawal_report_refund_complete_guard before insert or update or delete on public.academy_documents");
    expect(noComments(sql).match(/security definer/gi)).toHaveLength(1);
  });

  it("옛 단건(_v1) — 받는 처리 줄 하나만 정확히 한 번 치환(요청·승인·처리 거절)", () => {
    const blocks = doBlocks(noComments(sql));
    expect(blocks).toHaveLength(5); // 지문 검사 · _v1 · 할 일 동기화 · 할 일 닫기·취소 알림 빈칸(r3) · 사후 확인(함정 #155)
    const v1 = blocks[1]!;
    expect(v1).toContain("select pg_get_functiondef('public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)'::regprocedure) into definition;");
    expect(v1).toContain("if hits <> 1 then raise exception 's2_0036: _v1의 바꿀 줄 %번이 하나가 아닙니다(%건)', i, hits; end if;");
    const pairs = pairsOf(v1, "o");
    expect(pairs).toEqual([[
      "if p_action not in ('request','save','submit','approve','reject','cancel','apply') then raise exception '지원하지 않는 처리입니다.'; end if;",
      "if p_action not in ('save','submit','reject','cancel') then raise exception '옛 단건 퇴원보고서는 작성·제출·반려·취소만 할 수 있습니다. 요청을 취소한 뒤 작성 요청 창에서 다시 요청해 주세요.'; end if;",
    ]]);
  });

  it("할 일 동기화 — 원장 '환불 결정' 차례(refund:<원장 id>) · 세 줄 정확히 한 번 · 운영자 계정 제외 · 풀리면 처리됨", () => {
    const sync = doBlocks(noComments(sql))[2]!;
    expect(sync).toContain("select pg_get_functiondef('staff_tasks_private.withdrawal_sync_report(uuid)'::regprocedure) into definition;");
    expect(sync).toContain("if hits <> 1 then raise exception 's2_0036: 할 일 동기화의 바꿀 줄 %번이 하나가 아닙니다(%건)', i, hits; end if;");
    const pairs = pairsOf(sync, "o");
    expect(pairs.map(([o]) => o)).toEqual(["  v_today date := (now() at time zone 'Asia/Seoul')::date;", "  for x in", "    v_user := nullif(split_part(x.cycle, ':', 2), '')::uuid;"]);
    for (const [o, n] of pairs) expect(n.startsWith(o) || n.endsWith(o)).toBe(true);  // 원래 줄은 남기고 앞뒤에 더한다
    const added = pairs.map(([, n]) => n).join("\n");
    expect(added).toContain("v_cycle := 'refund:' || v_user::text;");
    expect(added).toContain("u.system_role::text = 'master' and not coalesce(public.is_super_admin(u.id), false)");
    expect(added).toContain("'퇴원보고서 환불 결정'");
    expect(added).toContain("case when coalesce(v_refund_settled, false) then 'refund_settled'");
    expect(added).not.toMatch(/--/);  // 주석은 짝 밖에(글자 대조가 주석 지우기에 흔들리지 않게)
  });

  it("🔴 사후 확인(함정 #155) — 바꾼 함수·새 함수는 service_role이 부르고 anon·authenticated는 못 부른다 · 트리거가 있다 · 아니면 거래 취소", () => {
    const post = doBlocks(noComments(sql))[4]!;
    for (const f of ["public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)", "public.attach_withdrawal_report_refund(uuid,uuid,uuid,uuid,uuid,boolean,jsonb,jsonb,jsonb)",
      "public.release_withdrawal_report_refunds(uuid,uuid,uuid,jsonb)", "public.withdrawal_report_refund_note(uuid,uuid,jsonb,uuid,boolean)",
      "public.decide_withdrawal_report_refund(uuid,uuid,uuid,jsonb,jsonb,jsonb)", "staff_tasks_private.withdrawal_sync_report(uuid)",
      "public.withdrawal_report_refunds_on_cancel(uuid,uuid,uuid,text)",
      "public.withdrawal_refund_blank(text)", "public.withdrawal_refund_won(text)", "public.withdrawal_refund_keys_overlap(text,text)",
      "public.withdrawal_refund_later_fingerprint(uuid,uuid,text)", "public.withdrawal_refund_gate_ready()", "public.withdrawal_refund_record_none(uuid,uuid,uuid,text,numeric,uuid,uuid)"]) expect(post).toContain(`'${f}'`);
    // 트리거 사건 셋 · 결정 표 권한(service_role에 지우기·비우기 없음 — 리뷰 r2 D-5) · 옛 8인자 연결 없음
    expect(post).toContain("(tgtype::int & 28) = 28");
    expect(post).toContain("foreach p in array array['delete', 'truncate', 'references', 'trigger'] loop");
    expect(post).toContain("if to_regprocedure('public.attach_withdrawal_report_refund(uuid,uuid,uuid,uuid,uuid,boolean,jsonb,jsonb)') is not null then");
    // r3 — 옛 5인자 환불 없음 없음 · 할 일 닫기 트리거 함수 실행권 · 연결 표 service_role은 select·insert만(R-6)
    expect(post).toContain("if to_regprocedure('public.decide_withdrawal_report_refund(uuid,uuid,uuid,jsonb,jsonb)') is not null then");
    expect(post).toContain("has_function_privilege('anon', 'staff_tasks_private.tg_refund_task()', 'execute')");
    expect(post).toContain("foreach p in array array['update', 'delete', 'truncate', 'references', 'trigger'] loop");
    expect(post).toContain("if has_table_privilege('service_role', 'public.withdrawal_report_refunds', p) then raise exception");
    expect(post).toContain("if not has_function_privilege('service_role', f, 'execute') then raise exception");
    expect(post).toContain("if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then");
    expect(post).toContain("tgname = 'withdrawal_report_refund_complete_guard'");
    expect(noComments(sql).indexOf(post)).toBeGreaterThan(noComments(sql).indexOf("create trigger withdrawal_report_refund_complete_guard"));
  });

  it("🔴 안전장치 — 지문 검사는 기대 글자 그대로(s2_0030 적용 뒤가 아니면 멈춤) · 거래 하나 · 시간 제한 한 번씩 · 다시 읽기 알림", () => {
    const code = noComments(sql);
    const blocks = doBlocks(code);
    expect(squash(blocks[0]!)).toBe(squash(guardText(BEFORE, "s2_0036: % 의 운영 정의가 기준(s2_0030 적용 뒤 · 2026-11-06)과 다릅니다(%). s2_0030을 먼저 적용했는지 보고, 바뀐 내용을 이 파일에 옮긴 뒤 지문을 갱신하세요.")));
    expect(code.indexOf(blocks[0]!)).toBeLessThan(code.indexOf("alter table"));
    expect(code.match(/\bbegin\s*;/gi)).toHaveLength(1);
    expect(code.match(/\bcommit\s*;/gi)).toHaveLength(1);
    expect(code.match(/\brollback\b/gi)).toBeNull();
    expect(code.match(/lock_timeout/gi)).toHaveLength(1);
    expect(code.match(/statement_timeout/gi)).toHaveLength(1);
    expect(code).toContain("notify pgrst, 'reload schema';");
    for (const v of Object.values(AFTER)) expect(sql).toContain(v);  // 적용 뒤 지문은 머리말에
    expect(sql).toContain(`되돌리기 = ${REVERT_FILE}`);
  });

  it("🔴 선행 지문 = s2_0030 파일에 적힌 '적용 뒤' 지문(처리 함수 · _v1) — 원장이 s2_0030 → s2_0036 차례로 적용(운영 2026-11-06 읽기 전용 확인 때 같은 값)", () => {
    // s2_0030 머리말의 '적용 뒤 지문' 줄: '… transition_withdrawal_report <md5> · transition_withdrawal_report_v1 <md5>'
    const after30 = (name: string) => base.match(new RegExp(`--[^\\n]*\\b${name} ([0-9a-f]{32})`))?.[1];
    expect(after30("transition_withdrawal_report")).toBe(BEFORE["public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)"]);
    expect(after30("transition_withdrawal_report_v1")).toBe(BEFORE["public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)"]);
    // s2_0030이 건드리지 않는 셋(연결 · release · 할 일 동기화)은 s2_0030의 선행 검사에도 없다 — s2_0025 그대로라 s2_0030 적용 전후 같다.
    for (const fn of ["attach_withdrawal_report_refund", "release_withdrawal_report_refunds", "withdrawal_sync_report"]) expect(noComments(base)).not.toContain(fn);
  });

  it("권한 — 새 함수·바꾼 함수마다 public·anon·authenticated에서 거두고 service_role만 · 결정 표 RLS · 지우는 함수는 두 옛 시그니처뿐", () => {
    const code = noComments(sql);
    for (const sig of [
      "public.withdrawal_report_refund_note(uuid, uuid, jsonb, uuid, boolean)", "public.attach_withdrawal_report_refund(uuid, uuid, uuid, uuid, uuid, boolean, jsonb, jsonb, jsonb)",
      "public.decide_withdrawal_report_refund(uuid, uuid, uuid, jsonb, jsonb, jsonb)", "public.release_withdrawal_report_refunds(uuid, uuid, uuid, jsonb)",
      "public.withdrawal_refund_record_none(uuid, uuid, uuid, text, numeric, uuid, uuid)",
    ]) {
      expect(code).toContain(`revoke all on function ${sig} from public, anon, authenticated;`);
      expect(code).toContain(`grant execute on function ${sig} to service_role;`);
    }
    expect(code).toContain("revoke all on function public.withdrawal_report_refund_complete_guard() from public, anon, authenticated;");
    expect(code).toContain("alter table public.withdrawal_report_refund_decisions enable row level security;");
    // 🔴 Supabase 기본 권한까지 거둔다(service_role 포함 — 리뷰 r2 D-5) · service_role은 select·insert·update만
    expect(code).toContain("revoke all on public.withdrawal_report_refund_decisions from public, anon, authenticated, service_role;");
    expect(code).toContain("grant select, insert, update on public.withdrawal_report_refund_decisions to service_role;");
    // 연결 표 — service_role은 넣기·읽기만(리뷰 r3 R-6)
    expect(code).toContain("revoke update, delete, truncate, references, trigger on public.withdrawal_report_refunds from service_role;");
    expect(code).toContain("revoke all on public.withdrawal_report_refunds from public, anon, authenticated;");
    for (const f of ["withdrawal_refund_blank(text)", "withdrawal_refund_won(text)", "withdrawal_refund_keys_overlap(text, text)", "withdrawal_refund_later_fingerprint(uuid, uuid, text)", "withdrawal_refund_gate_ready()"])
      expect(code).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
    expect(code.match(/\bdrop function\b[^;]*;/gi)).toEqual([
      "drop function public.attach_withdrawal_report_refund(uuid, uuid, uuid, uuid, uuid, boolean);",
      "drop function public.release_withdrawal_report_refunds(uuid, uuid, uuid);",
    ]);
    expect(code).not.toMatch(/function\s+public\.direct_withdrawal_report/i);   // 바로 처리 함수는 그대로(안의 apply가 확인 값 없이 미룬다)
    expect(code).not.toMatch(/function\s+public\.request_withdrawal_report_group/i);
  });

  it("🔴 빈칸 규칙 한 벌(리뷰 r2 D-11) — DB withdrawal_refund_blank의 글자 묶음이 앱 trim()이 지우는 글자와 정확히 같다(모든 BMP 글자)", () => {
    const body = dollarFn(sql, "withdrawal_refund_blank");
    const at = body.indexOf("~ '^[");
    const pattern = body.slice(at + 3, body.indexOf("'", at + 3));
    expect(pattern.startsWith("^[") && pattern.endsWith("]*$")).toBe(true);
    const re = new RegExp(pattern);
    const differ: string[] = [];
    for (let c = 0; c <= 0xffff; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      const ch = String.fromCharCode(c);
      if (re.test(ch) !== (ch.trim() === "")) differ.push(c.toString(16));
    }
    expect(differ).toEqual([]);
    // 앞뒤만이 아니라 전부 빈칸이어야 빈칸(앱은 trim 뒤 빈 글자인지 본다)
    expect(re.test(" \u00a0\u3000")).toBe(true);
    expect(re.test(" 2026-11-09 ")).toBe(false);
  });
  it("줄 키 형식 — 앱 LINE_KEY와 DB 검사식이 같은 줄을 받는다", () => {
    const dbKey = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}#(all|unalloc(:~?[a-z0-9_]{1,32}(\\.[a-z0-9_]{1,32}){0,9})?|[0-9a-z]{1,8}(-[0-9]{1,2})?)$";
    expect(count(sql, dbKey)).toBe(6);   // 결정 표 검사 · note(환불 가능·claimed) · attach(고른 줄·고르지 않은 줄) · decide
    expect(sql).not.toContain("#(all|[0-9a-z]{1,8}(-[0-9]{1,2})?)$'");   // 옛 검사식이 남지 않았다(미배분 과목 몫 키를 거절하지 않게)
    const re = new RegExp(dbKey, "i");
    for (const k of ["40000000-0000-4000-8000-000000000001#all", "40000000-0000-4000-8000-000000000001#ab12cd", "40000000-0000-4000-8000-000000000001#ab12cd-3",
      "40000000-0000-4000-8000-000000000001#unalloc", "40000000-0000-4000-8000-000000000001#unalloc:english.math", "40000000-0000-4000-8000-000000000001#unalloc:~subject_1"]) {
      expect(LINE_KEY.test(k)).toBe(true); expect(re.test(k)).toBe(true);
    }
    for (const k of ["40000000-0000-4000-8000-000000000001#*", "x#a", "40000000-0000-4000-8000-000000000001#toolongkey9", "40000000-0000-4000-8000-000000000001#unalloc:", "40000000-0000-4000-8000-000000000001#unalloc:~"]) {
      expect(LINE_KEY.test(k)).toBe(false); expect(re.test(k)).toBe(false);
    }
  });

  it("되돌리기 — 적용 뒤 지문일 때만 · 진행 중 대기·처리 안 된 승인 묶음이면 멈춤 · 처리 함수 = s2_0030 본문 · 연결·release = s2_0025 본문 · 거꾸로 치환 · 되돌린 뒤 지문 확인 · 거래 하나", () => {
    const code = noComments(revert);
    const blocks = doBlocks(code);
    expect(blocks).toHaveLength(6); // 적용 뒤 지문 · 멈춤 검사 · _v1 거꾸로 · 동기화 거꾸로 · 할 일 닫기·취소 알림 거꾸로(r3) · 되돌린 뒤 지문
    expect(squash(blocks[0]!)).toBe(squash(guardText(AFTER, "revert-s2_0036: % 의 정의가 s2_0036 적용 뒤와 다릅니다(%). 되돌리지 않습니다.")));
    expect(blocks[1]).toContain("select count(*) into held from public.withdrawal_report_groups where refund_hold and status in ('pending', 'scheduled');");
    expect(blocks[1]).toContain("and not public.withdrawal_report_refund_pending(g.id);");
    expect(blocks[1]).toContain("if held > 0 or stuck > 0 then");
    const restored = fn(revert, "transition_withdrawal_report"), original = fn(base, "transition_withdrawal_report");
    expect(restored.body).toBe(original.body);
    expect(restored.head.replace(/\s+/g, " ")).toBe(original.head.replace(/\s+/g, " "));
    for (const name of ["attach_withdrawal_report_refund", "release_withdrawal_report_refunds"]) {
      const a = dollarFn(revert, name), b = dollarFn(s25, name);
      expect(a, name).toBe(b);
    }
    expect(code).toContain("grant execute on function public.attach_withdrawal_report_refund(uuid, uuid, uuid, uuid, uuid, boolean) to service_role;");
    expect(code).toContain("grant execute on function public.release_withdrawal_report_refunds(uuid, uuid, uuid) to service_role;");
    const forward = doBlocks(noComments(sql));
    expect(pairsOf(blocks[2]!, "n")).toEqual(pairsOf(forward[1]!, "o").map(([o, n]) => [n, o]));
    expect(pairsOf(blocks[3]!, "n")).toEqual(pairsOf(forward[2]!, "o").map(([o, n]) => [n, o]));
    expect(squash(blocks[5]!)).toBe(squash(guardText(BEFORE, "revert-s2_0036: 되돌린 뒤 % 의 정의가 s2_0036 적용 전 지문과 다릅니다(%). 거래를 취소합니다.")));
    // r3 거꾸로 — 할 일 닫기·취소 알림 빈칸 = btrim · 연결 표 권한 복원
    expect(pairsOf(blocks[4]!, "o")).toEqual(pairsOf(forward[3]!, "o").map(([o, n]) => [n, o]));
    expect(code).toContain("grant update, delete, truncate, references, trigger on public.withdrawal_report_refunds to service_role;");
    expect(forward[3]).toContain("cancel_old constant text := $o$coalesce(btrim(d.form_data #>> '{result,completedDate}'), '') <> '' completed$o$;");
    expect(forward[3]).toContain("cancel_new constant text := $n$not public.withdrawal_refund_blank(d.form_data #>> '{result,completedDate}') completed$n$;");
    expect(forward[3]).toContain("if hits <> 1 then raise exception 's2_0036: 취소 알림의 바꿀 조건이 하나가 아닙니다(%건)', hits; end if;");
    expect(blocks[4]).toContain("cancel_old constant text := $o$not public.withdrawal_refund_blank(d.form_data #>> '{result,completedDate}') completed$o$;");
    expect(blocks[4]).toContain("cancel_new constant text := $n$coalesce(btrim(d.form_data #>> '{result,completedDate}'), '') <> '' completed$n$;");
    // 빈칸 함수를 지우기 전에 되돌린다(되돌린 본문이 지운 함수를 부르지 않게)
    expect(code.indexOf("cancel_new constant text")).toBeLessThan(code.indexOf("drop function public.withdrawal_refund_blank(text);"));
    expect(code.match(/\bbegin\s*;/gi)).toHaveLength(1);
    expect(code.match(/\bcommit\s*;/gi)).toHaveLength(1);
    expect(code).toContain("drop function public.decide_withdrawal_report_refund(uuid, uuid, uuid, jsonb, jsonb, jsonb);");
    expect(code).toContain("drop function public.withdrawal_report_refund_note(uuid, uuid, jsonb, uuid, boolean);");
    expect(code).toContain("drop trigger withdrawal_report_refund_complete_guard on public.academy_documents;");
    expect(code).not.toMatch(/drop table/i);  // 결정 기록은 남긴다
    // r2 — 새 함수 여섯을 지운다 · 🔴 관문 표식이 사라져 '새 앱 + 되돌린 DB'에서 앱이 멈춘다(리뷰 r2 D-7) · 9인자 연결을 지운다 · refund_pending = s2_0025 본문(btrim)
    expect(code).toContain("drop function public.attach_withdrawal_report_refund(uuid, uuid, uuid, uuid, uuid, boolean, jsonb, jsonb, jsonb);");
    for (const f of ["withdrawal_refund_record_none(uuid, uuid, uuid, text, numeric, uuid, uuid)", "withdrawal_refund_keys_overlap(text, text)", "withdrawal_refund_later_fingerprint(uuid, uuid, text)",
      "withdrawal_refund_won(text)", "withdrawal_refund_blank(text)", "withdrawal_refund_gate_ready()"]) expect(code).toContain(`drop function public.${f};`);
    const pending = fn(revert, "withdrawal_report_refund_pending").body;
    expect(pending).toContain("coalesce(btrim(d.form_data #>> '{result,completedDate}'), '') = ''");
    expect(squash(pending)).toBe(squash(fn(sql.replace("public.withdrawal_refund_blank(d.form_data #>> '{result,completedDate}')", "coalesce(btrim(d.form_data #>> '{result,completedDate}'), '') = ''"), "withdrawal_report_refund_pending").body));
  });
});
