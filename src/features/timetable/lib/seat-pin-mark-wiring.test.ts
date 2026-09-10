import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 배선 가드 — 자리(랩실) 교시 고정 표식이 **한 곳에서 나와 세 뷰에 같은 모양으로** 닿는지 구조로 잠근다.
 *
 * 이 표식은 눈으로만 확인되는 종류라(색·밑줄) 회귀가 조용하다. 특히 위험한 셋:
 *  ① 화면 파일이 `text-blue italic underline`을 **직접 적어** 뷰마다 갈리는 것,
 *  ② 셋 중 한 뷰만 고쳐 **같은 학생이 통합뷰에선 파랗고 기본뷰에선 검은** 것
 *     (영어의 기본 뷰가 통합뷰라 그쪽이 빠지면 원장이 매일 여는 화면에 표식이 없다),
 *  ③ 조회가 세션 클라이언트로 새는 것(그 표는 RLS 정책이 0개라 **에러 없이 0행**, [[#104]]).
 */
const ROOT = resolve(process.cwd());
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const MARK = "src/features/timetable/lib/seat-pin-mark.ts";
const LOADER = "src/features/timetable/server/seat-pins.ts";
const PAGE = "src/app/(shell)/timetable/page.tsx";

/** 학생 이름을 그리는 세 뷰 — 새 표면을 만들면 여기에도 한 줄 추가한다. */
const SURFACES = [
  "src/app/(shell)/timetable/_components/student-rows.tsx", // 기본뷰 + 합반
  "src/app/(shell)/timetable/_components/rich-card-group.tsx", // 통합뷰(영어 기본 뷰)
  "src/app/(shell)/timetable/_components/teacher-chip.tsx", // 강사뷰 칩
];

describe("자리 교시 고정 표식 배선", () => {
  it("표시 서식은 seat-pin-mark.ts 한 곳에만 적혀 있다", () => {
    const src = read(MARK);
    expect(src).toMatch(/export const SEAT_PIN_MARK_CLASS\s*=/);
    for (const f of SURFACES) {
      const body = read(f);
      // 화면은 상수를 import해서 쓸 뿐, 치수·색을 손으로 적지 않는다.
      expect(body, `${f}: 서식 상수를 import해야 한다`).toContain("SEAT_PIN_MARK_CLASS");
      expect(body, `${f}: 서식을 직접 적지 말 것`).not.toMatch(/text-blue[^"'`]*italic/);
    }
  });

  it("세 뷰가 모두 서버가 실어 보낸 문구(seatPinNote)를 읽는다 — 판정을 화면에서 다시 하지 않는다", () => {
    for (const f of SURFACES) {
      const body = read(f);
      expect(body, `${f}: seatPinNote를 읽어야 한다`).toContain("seatPinNote");
      // 화면이 pins·effective_from을 직접 해석하면 뷰마다 답이 갈린다.
      expect(body, `${f}: 고정 판정을 화면에서 하지 말 것`).not.toContain("effectiveFrom");
    }
  });

  it("시간표 페이지가 조회와 적용을 모두 배선했다", () => {
    const page = read(PAGE);
    expect(page).toContain("getSeatPins");
    expect(page).toContain("applySeatPinMarks");
    // 🔴 병렬이어야 한다 — `slots` 뒤에 await하면 직렬 워터폴(B4).
    const call = page.indexOf("getSeatPins(user.tenantId)");
    const promiseAll = page.indexOf("await Promise.all([");
    const closeAll = page.indexOf("]);", promiseAll);
    expect(call, "getSeatPins 호출을 못 찾았다").toBeGreaterThan(0);
    expect(call, "getSeatPins는 초기 Promise.all 안에 있어야 한다(B4)").toBeLessThan(closeAll);
  });

  it("조회는 admin 클라이언트 + 명시 tenant_id 필터 + 페이지네이션 + fail-soft", () => {
    const src = read(LOADER);
    // RLS 정책 0개 표라 세션 클라이언트로 읽으면 에러 없이 0행([[#104]]).
    expect(src).toContain("createAdminClient");
    expect(src).not.toContain("createClient()");
    expect(src, "admin은 RLS 우회라 tenant_id 필터가 필수").toContain('.eq("tenant_id", tenantId)');
    // 무페이징 select 금지(B2) — 고정이 쌓이면 1000행에서 조용히 잘린다.
    expect(src).toContain("fetchAllPaged");
    // 0255a 미적용에도 시간표는 살아야 한다([[#95]]).
    expect(src).toMatch(/catch\s*\{[\s\S]*return \[\]/);
    // 🔴 클라이언트 생성도 try 안이어야 한다 — 밖이면 키 누락 한 번에 시간표 전체가 500이다.
    const tryAt = src.indexOf("try {");
    const clientAt = src.indexOf("createAdminClient()");
    expect(tryAt, "try 블록이 없다").toBeGreaterThan(0);
    expect(clientAt, "createAdminClient()는 try 안에서 불러야 한다").toBeGreaterThan(tryAt);
  });

  it("주간 시간표는 '영구 고정'만 읽는다 — 하루짜리 이동은 안 싣는다", () => {
    const src = read(LOADER);
    expect(src).toContain("seat_period_pins");
    expect(src, "하루짜리는 자리 출석부의 축이다").not.toContain('from("seat_period_moves")');
  });
});
