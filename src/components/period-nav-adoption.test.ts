import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 구조 가드 — **기간 이동은 화면마다 다시 그리지 않는다.**
 *
 * 원장 2026-08-31 *"웹앱내에서 비슷한 곳은 다 방금 지시한 것으로"* → 09-01 *"주차이동을 월간처럼 깔끔한
 * 스타일로"* → *"출결 날짜 이동도 바꿔줘"*. 그전까지 같은 일을 하는 네비가 화면마다 제각각이었다
 * (주간은 `주 ◀ [이번주] ▶ 라벨`, 출석부는 `◀ 라벨 ▶`, 자리 하루는 `◀ [오늘] ▶`에 날짜가 아예 없었다).
 *
 * 🔴 잠그는 것은 **모양이 아니라 잃기 쉬운 두 가지**다:
 *  ① 그 기간으로 **돌아갈 길**(라벨 클릭) — 손으로 그린 네비는 이게 없어서 ◀를 누른 만큼 ▶를 눌러야 했다.
 *  ② **"지금 이번 기간인가"** 신호(과거/미래 조회 배지) — 없으면 지난 달·지난 날을 보면서 오늘로 착각한다.
 *    '이번주'·'오늘' 알약이 색으로 하던 일이라, 알약만 지우고 배지를 안 달면 정보가 사라진다.
 *
 * ⚠️ 새 기간 네비를 만들면 **여기 목록에 추가**할 것. 화살표를 손으로 그리지 말 것.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");

/** PeriodNav를 쓰기로 한 화면들 — 파일과 "무슨 기간인가". */
const ADOPTERS: { rel: string; what: string }[] = [
  { rel: "app/(shell)/timetable/_components/week-nav.tsx", what: "시간표·ECS 반 목록 주 이동" },
  { rel: "features/class-sheets/components/sheet-toolbar.tsx", what: "ECS 주간 시트 주 이동" },
  { rel: "features/class-sheets/components/month-client.tsx", what: "ECS 월간 뷰 달 이동" },
  { rel: "features/math-sheets/components/month-client.tsx", what: "MCS 월간 뷰 달 이동" },
  { rel: "app/(shell)/attendance/page.tsx", what: "월별 출석부 달 이동" },
  { rel: "app/(shell)/attendance/seat/[seat]/page.tsx", what: "자리 출석부 하루 이동" },
  { rel: "app/(shell)/attendance/seat/[seat]/month/page.tsx", what: "자리 월간 출석부 달 이동" },
  { rel: "app/(shell)/ecs/_components/today-nav.tsx", what: "ECS 오늘·자리 면 날짜 이동" },
];

describe("기간 이동 네비 = PeriodNav 단일 소스", () => {
  it.each(ADOPTERS)("$what 은 PeriodNav를 쓴다", ({ rel }) => {
    expect(read(rel)).toContain("PeriodNav");
  });

  it.each(ADOPTERS)("$what 에 손으로 그린 화살표가 없다", ({ rel }) => {
    // PeriodNav는 `prevAriaLabel`/`nextAriaLabel`로 받는다 — 맨 `aria-label="이전 …"`이 남아 있으면
    // 그 화면이 자기 화살표를 다시 그린 것이다.
    expect(read(rel)).not.toMatch(/aria-label="이전 (달|날|주)"/);
    expect(read(rel)).not.toMatch(/aria-label="다음 (달|날|주)"/);
  });

  it("PeriodNav가 '돌아갈 길'과 '지금 이번 기간인가'를 둘 다 들고 있다", () => {
    const nav = read("components/period-nav.tsx");
    // ① 라벨 클릭 = 이번 기간으로.
    expect(nav).toContain("currentHref");
    // ② 과거/미래 조회 배지 — 지우면 지난 기간을 보면서 오늘로 착각한다.
    expect(nav).toContain("RELATION_BADGE");
    expect(nav).toContain("과거 조회");
    expect(nav).toContain("미래 조회");
  });

  it("각 화면이 relation을 실제로 넘긴다(배지가 늘 꺼져 있지 않게)", () => {
    for (const { rel } of ADOPTERS) {
      expect(read(rel), rel).toMatch(/relation=\{/);
    }
  });

  it("🔴 라벨 폭은 최소가 아니라 **고정**이다(기간을 옮겨도 화살표가 안 흔들리게)", () => {
    // 원장 2026-09-01 "이동해도 크기 변동안되고 고정되게" — `minWidth`로 되돌리면 글자 수가 달라질 때마다
    // 화살표가 좌우로 움찔거린다(그 지적의 원인).
    const nav = read("components/period-nav.tsx");
    expect(nav).toContain("width: labelWidth");
    expect(nav).not.toContain("minWidth");
  });
});
