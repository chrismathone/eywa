import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 시간표 **보강 탭**(원장 2026-09-14) 배선 가드 — 예약 격자는 **표시 전용**이다.
 *
 * 🔴 예약(0264a)은 슬롯이 아니다 — 명단·인원·반/학생 드래그·충돌·엑셀/시트·강사뷰·빈 교시 판정 어디에도 안 들어간다.
 *    `*LAB` 임시 칸(virtual-lab-wiring)과 같은 결: 값은 한 컴포넌트(`MakeupWeekView`)로만 간다.
 */
const SRC = path.join(process.cwd(), "src");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const PAGE = strip(read("app/(shell)/timetable/page.tsx"));

describe("보강 탭 — 구분 축", () => {
  it("구분 드롭다운의 넷째 항목(보강)이고, URL kind=makeup으로 들어온다", () => {
    const kind = strip(read("features/timetable/lib/class-kind.ts"));
    expect(kind).toContain('export const TIMETABLE_KINDS: TimetableKind[] = ["regular", "special", "all", "makeup"];');
    expect(kind).toContain('makeup: "보강"');
    expect(PAGE).toContain("const makeupTab = isMakeupKind(kind);");
  });

  it("예약 값은 MakeupWeekView 한 곳으로만 간다 — 슬롯·명단·드래그·엑셀엔 안 실린다", () => {
    expect(PAGE).toContain("<MakeupWeekView");
    expect(PAGE).toContain("entries={makeupEntries}");
    // 선언(let) · 대입(=) · MakeupWeekView prop — 셋뿐. 넷째가 생기면 다른 컴포넌트로 흘러간 것이다(옛 검사는 import 줄 뒤 1200자를
    // 보는 공허한 검사였다 — 적대 리뷰 2026-09-14).
    expect(PAGE.split("makeupEntries").length - 1).toBe(3);
  });

  it("보강 탭에선 뷰·뷰 설정·엑셀·편집·검색이 접힌다(눌러도 아무 일도 안 일어나는 항목을 세우지 않는다)", () => {
    expect(PAGE).toMatch(/makeupTab \? null : \(\s*<span data-help="tt-view"[^>]*>\s*<ParamSelect\s*axisLabel="뷰"/);
    expect(PAGE).toContain("{isRooms || makeupTab ? null : (");
    expect(PAGE).toContain("{!makeupTab && (effView === \"basic\" || effView === \"integrated\") && slots.length > 0 && canEdit ? (");
    // 껍데기의 속성(className 등)은 자유 — 잠그는 것은 **보강 탭에서 접히는가**다(2026-09-16: 줄바꿈 수정으로 class가 붙어 낡았다).
    expect(PAGE).toMatch(/makeupTab \? null : \(\s*<span data-help="tt-search"[^>]*>\s*<TimetableSearchToggle \/>/);
  });

  it("교시 행·시각 → 행 판정은 슬롯과 같은 함수(subjectPeriodRows · slotPeriodRow), 라이브러리는 출석부 예약 조회", () => {
    expect(PAGE).toContain("subjectPeriodRows(subject, false, periodsConfig)");
    expect(PAGE).toContain("subjectPeriodRows(subject, true, periodsConfig)");
    expect(PAGE).toContain("slotPeriodRow(subject, r.slotStart, dow, periodsConfig, r.slotEnd)");
    expect(PAGE).toContain("getReservationsInWeek(referenceDate, [...classMeta.keys()])");
  });

  it("예약 격자는 hover 카드로 '보강 정보'를 보인다 — raw 코드 없이", () => {
    const view = strip(read("app/(shell)/timetable/_components/makeup-week-view.tsx"));
    expect(view).toContain("<HoverCard card={<InfoCard e={e} />}");
    expect(view).toContain("RESERVED_CELL_LABEL");
    expect(view).not.toMatch(/\breserved\b(?!_)/);
  });
});
