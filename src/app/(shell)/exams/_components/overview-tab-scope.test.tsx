import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { aggregateBy, withPreviousScores, type UnifiedRecord } from "@/features/grades/unified/model";
import { OverviewTab } from "./overview-tab";

/**
 * 성적 전체 현황의 제목은 조회가 돌려준 `scoped` 하나만 따른다(운영점검 2026-10-03 A24).
 * 같은 기록으로 그리면 범위 표시(제목·안내 앞머리)만 달라지고 숫자·목록은 한 글자도 달라지지 않아야 한다.
 */
const record = (key: string, studentId: string, name: string, score: number, date: string): UnifiedRecord => ({
  key,
  source: "grade",
  sourceId: key,
  studentId,
  name,
  school: "대구일중",
  grade: "중2",
  subject: "math",
  kind: "monthly",
  date,
  score,
  maxScore: 100,
  rawScore: null,
  classes: [{ id: "math-a", name: "수학 A", teacher: "김선생", days: 2 }],
  consultationDate: null,
  manualConsultationDate: null,
  editHref: `/students/${studentId}?tab=grades`,
});
const rows = withPreviousScores([
  record("g1", "s1", "김가람", 70, "2026-08-20"),
  record("g2", "s1", "김가람", 80, "2026-09-20"),
  record("g3", "s3", "박다온", 90, "2026-09-20"),
  record("g4", "s3", "박다온", 60, "2026-10-01"),
]);
const academy = aggregateBy(rows, "academy")[0];
const href = (patch: Record<string, string>) => `/exams?${new URLSearchParams(patch).toString()}`;
const render = (scoped: boolean) =>
  renderToStaticMarkup(
    <OverviewTab rows={rows} studentCount={2} academy={academy} missingCount={1} href={href} scoped={scoped} />,
  );
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("제목은 scoped를 따른다", () => {
  it("범위 없음(관리자) = 학원 통합 추이 — '담당 반'이라는 말이 없다", () => {
    const t = text(render(false));
    expect(t).toContain("학원 통합 추이");
    expect(t).not.toContain("담당 반");
    expect(t).toContain("선택한 기간·과목·시험의 기록이 있는 학생 기준입니다.");
  });

  it("범위 있음(강사·강사뷰) = 담당 반 통합 추이 — '학원 통합'이라고 적지 않는다", () => {
    const t = text(render(true));
    expect(t).toContain("담당 반 통합 추이");
    expect(t).toContain("담당 반 · 선택한 기간·과목·시험의 기록이 있는 학생 기준입니다.");
    expect(t).not.toContain("학원 통합");
    expect(t).not.toContain("학원 전체");
  });
});

describe("범위 표시는 숫자를 바꾸지 않는다", () => {
  it("🔴 같은 기록이면 제목·안내 앞머리 말고는 화면이 완전히 같다", () => {
    const scoped = render(true)
      .replace("담당 반 통합 추이", "학원 통합 추이")
      .replace("담당 반 · 선택한 기간", "선택한 기간");
    expect(scoped).toBe(render(false));
  });

  it("지표 다섯 칸의 값이 집계 그대로다(응시 학생·기록 수·평균 정답률·상승·하락·미입력)", () => {
    // 평균 = (70 + 80 + 90 + 60) / 4 = 75. 상승 1건(s1 70→80), 하락 1건(s3 90→60).
    expect(academy).toMatchObject({ count: 4, average: 75 });
    for (const scoped of [false, true]) {
      const t = text(render(scoped));
      expect(t, String(scoped)).toMatch(/응시 학생\s*2\s*명/);
      expect(t, String(scoped)).toContain("기록 4건");
      expect(t, String(scoped)).toMatch(/평균 정답률\s*75\s*%/);
      expect(t, String(scoped)).toMatch(/상승\s*1\s*건/);
      expect(t, String(scoped)).toMatch(/하락\s*1\s*건/);
      expect(t, String(scoped)).toMatch(/미입력\s*1\s*건/);
    }
  });

  it("기록이 없는 담당 범위(담당 반 0개)도 '담당 반'이라고 적는다", () => {
    const t = text(
      renderToStaticMarkup(
        <OverviewTab rows={[]} studentCount={0} academy={undefined} missingCount={0} href={href} scoped />,
      ),
    );
    expect(t).toContain("담당 반 통합 추이");
    expect(t).not.toContain("학원 통합");
    expect(t).toMatch(/응시 학생\s*0\s*명/);
  });
});

describe("배선 — 화면의 scoped는 조회가 돌려준 그 값이다", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const dashboard = read("src/app/(shell)/exams/_components/unified-dashboard.tsx");
  const queries = read("src/features/grades/unified/server/queries.ts");

  it("대시보드는 조회 결과의 scoped를 그대로 넘긴다 — 범위를 한 번 더 판정하지 않는다", () => {
    expect(dashboard).toContain("scoped={data.scoped}");
    expect(dashboard).toMatch(/getUnifiedGrades\(fetchFrom, fetchTo\)/);
    expect(dashboard).not.toMatch(/effectiveTeacherScope|effectiveTeacherId|systemRole === "teacher"/);
  });

  it("조회의 scoped는 기록을 거르는 그 변수(scope)에서 나온다", () => {
    expect(queries).toContain("effectiveTeacherScope(),");
    expect(queries).toContain("scoped: !!scope,");
    expect(queries).toContain("if (scope && classIds.length === 0) return { ...EMPTY, scoped: true };");
    // 역할 이름이나 강사 id만으로 scoped를 만들지 않는다.
    expect(queries).not.toMatch(/scoped:\s*(user\.systemRole|!!teacherId|teacherId\s*!==)/);
  });
});
