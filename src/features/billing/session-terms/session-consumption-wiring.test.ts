/**
 * 2026-09-16: 새 확정은 출석부 시수, 기존 확정은 일수 스냅샷을 보존한다.
 *
 * 🔴 이 가드가 없으면 규칙이 **조용히** 되돌아간다. 골든마스터(`billing/golden`)는 RPC를 호출하지 않고
 *    동결된 `rpcConsumed` 숫자를 *입력*으로 쓰기 때문에, 세는 법을 바꾸든 되돌리든 **테스트는 그대로 통과**하고
 *    핀만 낡는다(적대 리뷰 2026-09-14가 짚은 구멍). 그래서 SQL 본문을 직접 잠근다.
 *
 * ⚠️ **이 가드가 초록이어도 프로덕션 DB가 같다는 뜻은 아니다** — aywa는 SQL을 사람이 손으로 적용하므로
 *    리포와 DB가 갈릴 수 있다(가드가 보는 것은 저장소의 파일뿐이다). 세는 법이 의심되면
 *    `pg_get_functiondef('public.session_term_attendance(text)'::regprocedure)`로 **실제 함수 본문**을 확인할 것.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 🔴 **마지막 정의가 이긴다** — 0263a 파일 하나만 읽으면 다음 마이그레이션이 같은 이름을
 *    `create or replace`로 되돌려도 이 가드는 그대로 통과한다. 가상의 위험이 아니라 이 함수에
 *    **실제로 네 번** 일어난 일이다(0103a → 0115a → 0198a → 0263a). 그래서 migrations를 전수로 훑어
 *    **파일명 정렬 마지막** 정의를 검사 대상으로 삼는다(적대 리뷰 2026-09-14 H2).
 */
const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
/**
 * 🔴 `create or replace`만 찾으면 안 된다 — **0115a가 바로 그 문으로 이 함수를 갈아치웠다**:
 *    반환형이 int → numeric으로 바뀌어 replace가 불가능하니 `drop function … ;` 뒤 **맨 `create function`**.
 *    즉 되돌림이 실제로 지나간 적 있는 경로라, `or replace`를 선택적으로 둔다.
 * 🔴 **스키마 접두도 선택이다** — 이 리포엔 `public.` 없이 함수를 정의한 마이그레이션이 8개 있고
 *    (0090a·0092a·0117a·0124a·0127a·0128a·0135a·0152a), 그중 0135a·0152a는 drop 후 재생성까지
 *    접두 없이 한다. 기본 search_path가 public이라 접두 없는 재정의도 **같은 함수를 갈아끼운다**.
 */
const DEFINES_RPC = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?session_term_attendance\b/i;
const DROPS_RPC = /drop\s+function[^;]*\bsession_term_attendance\b/i;

const sqlFiles = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort(); // 접두 4자리 제로패딩(`NNNNa_`) 파일끼리는 파일명 정렬 = 적용 순서(규약 밖 타임스탬프 이름은 아래 offConvention)
const readMigration = (f: string) => readFileSync(join(MIGRATIONS_DIR, f), "utf8");

/**
 * **뒤에서부터** 훑어 첫 정의에서 멈춘다 — 마이그레이션은 계속 늘어나는 축이고(지금 314개),
 * 이 리포엔 "전체 vitest를 겹쳐 돌리면 파일스캔 가드가 타임아웃으로 헛실패"한 전례가 있다.
 * 정의를 만나기 전에 지나친 파일들이 곧 "마지막 정의 **뒤**"라, 같은 한 번의 훑기로 drop도 모은다.
 */
let latestFile: string | undefined;
/** 마지막 정의 뒤에 남은 drop — 함수가 사라졌는데 가드는 옛 정의를 보며 통과하는 창을 막는다. */
const dropsAfterLatest: string[] = [];
for (const f of [...sqlFiles].reverse()) {
  const src = readMigration(f);
  if (DEFINES_RPC.test(src)) {
    latestFile = f;
    break;
  }
  if (DROPS_RPC.test(src)) dropsAfterLatest.push(f);
}

/** 주석은 규칙을 **설명**하는 자리라 본문 검사에서 뺀다(`--` 줄 제거). */
const body = latestFile
  ? readFileSync(join(MIGRATIONS_DIR, latestFile), "utf8").replace(/^\s*--.*$/gm, "")
  : "";

/**
 * 한 파일 안에 정의가 둘이면 **뒤엣것이 이긴다** — 새 정의 뒤에 옛 정의를 덧붙이면 본문 검사는
 * 새 정의를 보고 통과하는데 실제로 사는 함수는 옛것이다. 그래서 "정의는 파일당 하나"를 못박는다.
 */
const defCount = (body.match(new RegExp(DEFINES_RPC.source, "gi")) ?? []).length;

/**
 * "파일명 정렬 = 적용 순서"는 **명명 규약이 지켜질 때만** 참이다(4자리 제로패딩 + 선택 접미).
 * 규약 밖 이름(`00_…`처럼 앞서 정렬되는 것, CLI 타임스탬프 `20261007171329_…`처럼 뒤로 몰리는 것)은
 * 정렬 위치가 적용 순서를 보장하지 못한다.
 *
 * ⚠️ 2026-10-22 기준 규약 밖 타임스탬프 이름이 **이미 48개** 있다(10-07~10-22 여러 세션이 Supabase CLI로 만든 것,
 *    [[#139]]). 다른 세션이 계속 작업 중이라 **일괄 개명은 보류**했다(참조 깨짐·충돌 위험). 그래서 이 검사는
 *    "규약 밖 파일이 하나도 없다"에서 **"규약 밖 파일 중 session_term_attendance를 건드리는(정의·삭제·언급) 것이 없다"**로 좁혔다 —
 *    이 함수를 다루는 파일이 전부 `NNNNa_`면 그들 사이의 정렬은 여전히 적용 순서라 "마지막 정의" 판정이 선다.
 *    🔴 새 마이그레이션은 여전히 `NNNNa_` 이름으로 만든다(규약은 그대로다 — 좁힌 것은 이 가드의 범위뿐).
 */
const offConvention = sqlFiles.filter((f) => !/^\d{4}[a-z]?_/.test(f));
const offConventionTouchingRpc = offConvention.filter((f) => /\bsession_term_attendance\b/i.test(readMigration(f)));

describe("회차 소비 — 배선", () => {
  it("🔴 검사 대상 = session_term_attendance를 **마지막으로 정의한** 마이그레이션", () => {
    // 정의가 아예 없으면(파일 개명·삭제) 아래 본문 검사가 빈 문자열을 통과시키므로 여기서 먼저 막는다.
    expect(latestFile).toBeDefined();
    // 마지막 정의 뒤에 drop만 남으면 함수가 없는 것이다 — 옛 정의를 보며 통과시키지 않는다.
    expect(dropsAfterLatest).toEqual([]);
    // 한 파일에 정의가 둘이면 뒤엣것이 이긴다 — 본문 검사가 앞엣것만 보고 통과하지 않게.
    expect(defCount).toBe(1);
    // 이 함수를 다루는 파일이 규약 밖 이름이면 "정렬 = 적용 순서" 전제가 무너진다(규약 밖 파일은 정렬 위치를 보장 못 한다).
    // (규약 밖 이름 전체 검사는 2026-10-22에 좁혔다 — 위 offConvention 주석.)
    expect(offConventionTouchingRpc).toEqual([]);
    // 마지막 정의 파일 자체도 규약 안이어야 한다(위 검사가 이미 함의하지만 판정 대상을 직접 못박는다).
    expect(latestFile).toMatch(/^\d{4}[a-z]?_/);
  });

  it("새 확정은 시수 합, 기존 확정은 저장한 일수 기준으로 검증한다", () => {
    expect(body).toContain("count(distinct e.session_date)");
    expect(body).toContain("sum(coalesce(e.session_units, 1))");
    expect(body).toContain("case when t.quantity_basis = 'attendance_units'");
    expect(body).toContain("when st.confirmed_sessions is null then 'attendance_units' else st.quantity_basis");
  });

  it("집계 키는 청구서 × 반으로 유지한다", () => {
    expect(body).toContain("group by t.invoice_id, t.class_id");
    expect(body).toContain("left join eff e on e.student_id = t.student_id and e.class_id = t.class_id");
  });

  it("🔴 날짜를 세려면 eff가 session_date를 실어야 한다 — 0198a 본문엔 없던 컬럼이다", () => {
    // 🔴 앵커는 `distinct on (…)` **바로 다음의 select 목록**이다 — 맨 패턴으로 두면
    //    `order by ar.student_id, ar.class_id, ar.session_date, …` 줄에도 걸려,
    //    select에서 session_date만 빼도 단언이 통과한다(적대 리뷰 L1).
    expect(body).toMatch(
      /distinct on \([^)]*\)\s*ar\.student_id,\s*ar\.class_id,\s*ar\.session_date,\s*ar\.status/,
    );
    // 정정 이력 dedup(교시별 최신)은 그대로 — 세는 단위가 아니라 '유효 기록' 판정이다.
    expect(body).toContain("distinct on (ar.student_id, ar.class_id, ar.session_date, ar.slot_start)");
  });

  it("소비 인정 상태와 반환 타입은 안 바뀐다(호출부 2곳이 그대로 돈다)", () => {
    expect(body).toContain("e.status in ('present', 'late', 'early_leave', 'makeup')");
    expect(body).toContain("returns table (invoice_id uuid, class_id uuid, consumed numeric)");
    expect(body).toContain("security invoker");
    expect(body).toContain("auth_tenant_id()");
  });

  it("⚠️ 시수(session_units)를 바꾸지 않는다 — 출석부·급여가 쓰는 값은 이 파일 밖이다", () => {
    expect(body).not.toContain("update attendance_records");
    expect(body).not.toContain("set session_units");
  });
});
