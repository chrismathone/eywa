import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 배선 가드 — 시간표 통합뷰 **\*LAB 임시 칸**(원장 2026-09-11)이 **표시 한 곳에만** 닿는지 구조로 잠근다.
 *
 * 이 칸은 수업설정(`class_schedules`)에 없는 **표시 전용 파생**이다. 새면 에러 없이 조용히 틀린다:
 *  · 인원·교시 수가 부풀고(명단·집계가 슬롯에서 나온다), 반 드래그 판정·학생 드래그 빗금·충돌 검사가 없는 수업을
 *    막고, 엑셀·시트에 수업설정에 없는 LAB이 적힌다(시트를 다시 가져오면 **진짜 배치**가 된다).
 *  · 판정을 화면에서 다시 짜면 자리 출석부와 **다른 교시**에 학생을 세운다(두 화면이 한 학생을 다르게 말한다).
 * 전부 값이 아니라 "어느 코드를 거치는가"라서 단위 테스트로는 안 잡힌다.
 */
const ROOT = resolve(process.cwd());
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** 주석을 걷어낸 본문 — 주석에 적힌 낱말이 가드를 통과시키지 않게. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const PURE = "src/features/timetable/lib/virtual-lab.ts";
const MOVES = "src/features/timetable/server/seat-moves.ts";
const PINS = "src/features/timetable/server/seat-pins.ts";
const PAGE = "src/app/(shell)/timetable/page.tsx";
const VIEW = "src/app/(shell)/timetable/_components/rich-grid-view.tsx";
const CARD = "src/app/(shell)/timetable/_components/rich-card-group.tsx";

/** `virtual-lab` 모듈을 import해도 되는 파일 — 새 소비처를 만들면 **왜 새지 않는지** 확인하고 여기에 한 줄 추가한다. */
const ALLOWED_IMPORTERS = new Set([
  PAGE,
  VIEW,
  CARD,
  MOVES,
  PINS,
  "src/features/timetable/lib/virtual-lab.test.ts",
  "src/features/timetable/server/seat-moves.test.ts",
  "src/app/(shell)/timetable/_components/rich-card-group.virtual-lab.test.tsx",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("*LAB 임시 칸 — 새지 않는다", () => {
  // ⚠️ `src` 전수를 읽는 가드라 기본 한도(5초)로는 **전 스위트를 함께 돌릴 때만** 타임아웃난다
  //    (단독 2초 · 병렬 부하에서 초과). 아이콘 가드와 같은 처방 = 60초(2026-09-15).
  it("🔴 `virtual-lab`을 import하는 파일은 정해진 몇 곳뿐 — 인원·드래그·충돌·엑셀/시트·강사뷰·기본뷰로 새지 않는다", () => {
    const importers = walk("src")
      .filter((f) => /from\s+["'][^"']*\/virtual-lab["']/.test(read(f)))
      .map((f) => relative(ROOT, join(ROOT, f)).split("\\").join("/"));
    const stray = importers.filter((f) => !ALLOWED_IMPORTERS.has(f));
    expect(stray, "허용 목록 밖에서 *LAB 재료를 쓴다").toEqual([]);
  }, 60_000);

  it("🔴 섹션 교시축·반 드래그·학생 빗금·강사뷰·기본뷰·교실뷰·배치 편집·엑셀/시트는 이 칸을 **모른다**", () => {
    const blind = [
      "src/features/timetable/lib/class-grid.ts", // 교시축(periodRows)·카드 칸·인원 — 엑셀도 이 결과를 쓴다
      "src/features/timetable/lib/used-rows.ts", // 빈 교시 판정
      "src/features/timetable/lib/class-move.ts", // 반 드래그 판정
      "src/features/timetable/lib/class-windows.ts", // 학생 드래그 빗금 좌표
      "src/features/timetable/lib/student-busy.ts",
      "src/features/timetable/lib/teacher-grid-model.ts", // 강사뷰
      "src/features/timetable/lib/room-grid.ts", // 교실뷰
      "src/features/exports/timetable-excel.ts",
      "src/app/(shell)/timetable/_components/weekday-group-tables.tsx", // 기본뷰
      "src/app/(shell)/timetable/_components/teacher-grid.tsx",
      "src/app/(shell)/timetable/_components/room-map-view.tsx",
      "src/app/(shell)/timetable/_components/integrated-edit-board.tsx", // 배치 편집(수업명만)
      ...walk("src/features/exports"),
      ...walk("src/features/integrations"),
    ];
    for (const f of blind) {
      const body = read(f);
      expect(body, `${f}: *LAB 재료를 몰라야 한다`).not.toMatch(/virtualLabs|VIRTUAL_LAB|virtual-lab/);
    }
  });

  it("🔴 page: 이 값은 **RichGridView 한 곳으로만** 간다 — 슬롯·반 드래그 색인·다른 뷰 props에 안 실린다", () => {
    const page = strip(read(PAGE));
    const decl = page.indexOf("const virtualLabs =");
    const viewAt = page.indexOf("<RichGridView");
    const viewEnd = page.indexOf("/>", viewAt);
    expect(decl, "virtualLabs 계산을 못 찾았다").toBeGreaterThan(0);
    expect(viewAt, "RichGridView를 못 찾았다").toBeGreaterThan(0);
    expect(page.slice(viewAt, viewEnd)).toContain("virtualLabs={virtualLabs}");
    for (const m of page.matchAll(/\bvirtualLabs\b/g)) {
      const at = m.index ?? -1;
      const inDecl = at === decl + "const ".length;
      const inView = at > viewAt && at < viewEnd;
      expect(inDecl || inView, `virtualLabs가 RichGridView 밖에서 쓰였다(위치 ${at})`).toBe(true);
    }
    // 통합뷰 읽기 화면에서만, 재료 둘(고정·하루 이동)을 **다 알 때만** 만든다(`knownLabSources` — 하나라도 모르면
    // 칸 없음, 둘 다 0줄이어도 null이라 추가 조회 0). 이 흐름 그대로의 실행 확인은 seat-moves.test.ts.
    expect(page).toContain("isIntegrated && !groupEditing ? knownLabSources(seatPins, seatMoves) : null");
    // 🔴 판정엔 knownLabSources가 넘긴 재료만 — 조회 결과를 직접 넘기면 실패(모름)가 "0줄"로 들어가 거짓 칸이 선다.
    const buildAt = page.indexOf("buildVirtualLabs({");
    const build = page.slice(buildAt, page.indexOf("})", buildAt));
    expect(buildAt, "buildVirtualLabs 호출을 못 찾았다").toBeGreaterThan(0);
    expect(build).toContain("pins: labSources.pins");
    expect(build).toContain("moves: labSources.moves");
    expect(build).not.toMatch(/seatPins|seatMoves/);
  });

  it("page: 하루 이동 조회는 초기 Promise.all 안(B4) · 이름 표식(파란 밑줄)은 여전히 **고정만**", () => {
    const page = strip(read(PAGE));
    const promiseAll = page.indexOf("await Promise.all([");
    const closeAll = page.indexOf("]);", promiseAll);
    const call = page.indexOf("getSeatWeekMoves(user.tenantId, referenceDate)");
    expect(call, "getSeatWeekMoves 호출을 못 찾았다").toBeGreaterThan(promiseAll);
    expect(call, "getSeatWeekMoves는 초기 Promise.all 안에 있어야 한다(B4)").toBeLessThan(closeAll);
    const markAt = page.lastIndexOf("applySeatPinMarks(");
    const mark = page.slice(markAt, page.indexOf(");", markAt));
    expect(mark).toContain("pins: seatPins.pins");
    expect(mark, "하루 이동은 *LAB 칸에만 — 이름 표식은 원장이 말한 '영구 이동'만").not.toContain("seatMoves");
  });
});

describe("*LAB 임시 칸 — 판정은 자리 출석부와 같은 함수", () => {
  it("🔴 순수 규칙은 자리 출석부 하루치 판정을 **그대로** 부른다 — 새 규칙을 적지 않는다", () => {
    const src = strip(read(PURE));
    expect(src).toContain('from "@/features/attendance/seat/period-choice"');
    expect(src).toContain("applySeatPeriodChoicesByPeriod(");
    expect(src).toContain("resolveSeatPeriodChoices(");
    // 교시 판정을 따로 부르면 자리 출석부의 '옮겨 온 묶음' 규칙(명단 재료·자기 칸)과 갈린다.
    expect(src).not.toContain("seatChoiceTarget(");
    // 명단 판정도 자리 명단(`loadSeatDay`)과 같은 두 함수.
    expect(src).toContain("isEnrollmentActiveOn(");
    expect(src).toContain("resolveAttendDows(");
    // 교시축 행은 카드 빌더와 같은 함수로 잰다.
    expect(src).toContain("slotPeriodRow(");
  });

  it("카드는 **어디에 그릴지**만 정한다 — 서식·글자는 단일 소스, 배치 편집(수업명만)엔 안 그린다", () => {
    const card = strip(read(CARD));
    expect(card).toContain("placeVirtualLabs(");
    expect(card).toContain("borrowFromRoster(");
    expect(card).toContain("VIRTUAL_LAB_CELL_CLASS");
    expect(card).toContain("VIRTUAL_LAB_LABEL");
    expect(card, "`*LAB` 글자를 화면 파일에 다시 적지 말 것").not.toContain('"*LAB"');
    expect(card).not.toMatch(/resolveSeatPeriodChoices|applySeatPeriodChoices/);
    expect(card).toContain("namesOnly ? undefined : virtualLabs?.[card.classId]");
    // 자리는 **화면이 실제로 그리는 행**(접혀 감춘 행 제외)으로 정한다 — 섹션 축 전체를 넘기면 감춘 행에 앉은 칸이
    // 격자 키로만 들어가고 아무 데도 안 그려진다(렌더 테스트 rich-card-group.virtual-lab.test.tsx가 실제로 본다).
    expect(card).toMatch(/placeVirtualLabs\(\{[^}]*rows: gridRows/);
    // 빌리는 높이는 **전입 예정 줄까지** 명단으로 센다 — 빼면 미리보기 줄이 페이드 아래로 숨는다.
    expect(card).toContain("card.active.length + incomingNow.length) * STU_H");
  });
});

describe("*LAB 임시 칸 — 조회", () => {
  it("하루 이동: admin + 명시 tenant_id + **표시 주 범위** + 페이지네이션 + fail-soft", () => {
    const src = read(MOVES);
    // RLS 정책 0개 표라 세션 클라이언트로 읽으면 에러 없이 0행([[#104]]).
    expect(src).toContain("createAdminClient");
    expect(src).not.toContain("createClient()");
    expect(src).toContain('.eq("tenant_id", tenantId)');
    // 필터 없는 전건 금지(B2) — 표시 주(월~일)만, 그래도 페이지네이션.
    expect(src).toContain("weekBoundsOf(referenceDate)");
    expect(src).toContain('.gte("session_date", start)');
    expect(src).toContain('.lte("session_date", end)');
    expect(src).toContain("fetchAllPaged");
    // 0255a 미적용·실패에도 시간표는 산다([[#95]]) — 단 실패는 **null(모름)**이지 "이동 0줄"(`[]`)이 아니다
    // (0줄로 읽으면 고정만 보고 거짓 칸이 선다 — 실행 확인은 seat-moves.test.ts).
    expect(strip(src)).toMatch(/\}\s*catch\s*\{\s*return null;\s*\}/);
    expect(strip(src)).not.toMatch(/catch\s*\{\s*return \[\];/);
    const tryAt = src.indexOf("try {");
    const clientAt = src.indexOf("createAdminClient()");
    expect(tryAt, "try 블록이 없다").toBeGreaterThan(0);
    expect(clientAt, "createAdminClient()는 try 안에서 불러야 한다").toBeGreaterThan(tryAt);
  });

  it("🔑 이동이 있으면 **병렬 가지 안에서** 학원 전체 배치를 읽어 둔다 — page의 await는 캐시 적중(B4)", () => {
    const src = strip(read(MOVES));
    expect(src).toContain('from "./seat-pins"');
    expect(src).toMatch(/if \(moves\.length > 0\) await getSeatLiveSlots\(tenantId, referenceDate\)/);
    // 반환 앞(try 안)이어야 병렬 단계 안이다 — 실행 확인은 seat-moves.test.ts.
    expect(src.indexOf("await getSeatLiveSlots(")).toBeLessThan(src.indexOf("return moves;"));
  });

  it("🔴 학원 전체 배치 조회도 fail-soft — 클라이언트 생성까지 try 안 · 실패는 null · page가 한 번 더 받는다", () => {
    const pins = strip(read(PINS));
    const body = pins.slice(pins.indexOf("export const getSeatLiveSlots = cache("));
    const tryAt = body.indexOf("try {");
    expect(tryAt, "getSeatLiveSlots에 try 블록이 없다").toBeGreaterThan(0);
    expect(body.indexOf("createAdminClient()"), "createAdminClient()는 try 안에서").toBeGreaterThan(tryAt);
    expect(body).toMatch(/catch\s*\{\s*return null;/);
    // page의 await는 어떤 try에도 싸여 있지 않다 — 안쪽 catch 하나가 빠져도 전면 500이 되지 않게.
    expect(strip(read(PAGE))).toContain("getSeatLiveSlots(user.tenantId, referenceDate).catch(() => null)");
  });

  it("🔑 학원 전체 배치는 **한 번** — React cache로 이름 표식과 *LAB이 나눠 쓴다(끝 시각까지)", () => {
    const pins = strip(read(PINS));
    expect(pins).toContain("export const getSeatLiveSlots = cache(");
    expect(pins).toContain("getSeatLiveSlots(tenantId, referenceDate)");
    expect(pins).toContain("end_time");
    expect(strip(read(PAGE))).toContain("getSeatLiveSlots(user.tenantId, referenceDate)");
  });

  it("RichGridView는 받은 값을 보드에 넘길 뿐 — 슬롯에 섞지 않는다", () => {
    const view = strip(read(VIEW));
    expect(view).toContain("virtualLabs={virtualLabs}");
    expect(view).toContain("classWindowsFromSlots(slots)");
    expect(view).not.toMatch(/slots[^\n]*virtualLabs|virtualLabs[^\n]*slots/);
  });
});
