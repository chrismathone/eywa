import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StudentConsultationRow } from "@/features/consultations/server/queries";
import type { ConsultationRating } from "@/features/consultation-rating/rating";

// 창·현재 입력자 표시·배치 크기 측정은 이 테스트가 보려는 것(열 구성)과 무관하다.
vi.mock("@/components/workspace/window-link", () => ({ WindowLink: ({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) => <a href={href} className={className}>{children}</a> }));
vi.mock("@/features/presence/editing-badge", () => ({ EditingBadge: () => null }));
vi.mock("@/components/auto-page-size", () => ({ AutoPageSize: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/makeedu-origin-tag", () => ({ MakeeduOriginTag: () => <span>이관</span> }));
import { ConsultationList } from "./consultation-list";

afterEach(cleanup);

const row = (over: Partial<StudentConsultationRow> = {}): StudentConsultationRow => ({
  id: "c1", studentId: "s1", studentName: "김하나", studentGrade: "중1", counselorName: "이선생", consultedAt: "2026-11-10T09:00:00+09:00", category: "general", subject: "수학",
  audience: "parent", summary: "방학특강 안내", followUpAction: "다음 주 재연락", followUpDate: "2026-11-01", followUpDone: false, processingStatus: "completed",
  hasAudio: true, hasAi: true, syncAddedAt: null, counselorId: "u1", classId: null, className: "중등M", classSource: null, classAuto: false, ...over,
});
const rating: ConsultationRating = { points: 4, reason: "이유", evidence: "", kinds: [], missing: [], rule: null, basis: "memo", ratedOn: "2026-11-11" };

describe("원생상담 목록 열 구성(2026-11-11 — 후속·녹음·AI 열을 걷고 상담 평점 열 · 원장 열 순서)", () => {
  it("머리글 = 과목 | 학생 | 학교학년 | 반 이름 | 상담자 | 날짜 | 카테고리 | 상담 평점 — 후속·녹음·AI는 없다", () => {
    const { container } = render(<ConsultationList items={[row()]} size={30} pageSizeKey="t" classOn ratings={new Map([["c1", rating]])} />);
    const header = container.querySelector("[data-list-header] > div")!; // 첫 벌(두 번째 벌은 2단용 사본)
    const labels = [...header.querySelectorAll("span")].map((s) => s.textContent).filter((t) => t && t !== "요약");
    expect(labels).toEqual(["과목", "학생", "학교학년", "반 이름", "상담자", "날짜", "카테고리", "상담 평점"]);
    expect(header.textContent).not.toMatch(/후속|녹음/);
  });

  it("학교학년 칸 = 학교+학년 압축('경명여중1') · 학교가 없으면 학년만 · 학생 칸엔 이름만", () => {
    const { container, rerender } = render(<ConsultationList items={[row({ studentSchool: "경명여중", studentGrade: "중1" })]} size={30} pageSizeKey="t" classOn ratings={null} />);
    const cells = () => [...container.querySelectorAll("li a > p")].map((p) => p.textContent);
    expect(cells()).toContain("경명여중1");
    rerender(<ConsultationList items={[row({ studentSchool: null, studentGrade: "중2" })]} size={30} pageSizeKey="t" classOn ratings={null} />);
    expect(cells()).toContain("중2");
    expect(cells()[0]).toBe("수학"); // 첫 열 = 과목
  });

  it("평점 열이 꺼지면(ratings=null) 열을 통째로 뺀다 — '—'만 늘어선 열을 남기지 않는다", () => {
    const { container } = render(<ConsultationList items={[row()]} size={30} pageSizeKey="t" classOn ratings={null} />);
    expect(container.querySelector("[data-list-header]")!.textContent).not.toContain("상담 평점");
    expect(container.querySelector("li")!.textContent).not.toContain("—"); // 이 행은 반 이름이 있어 '—'가 없다 = 평점 칸도 안 그렸다
  });

  it("행: 평점이 없는 상담은 '—', 있으면 숫자 · 후속 알약·녹음/AI 표식은 어디에도 없다", () => {
    const { container } = render(<ConsultationList items={[row(), row({ id: "c2" })]} size={30} pageSizeKey="t" classOn ratings={new Map([["c1", rating]])} />);
    const [a, b] = [...container.querySelectorAll("li")];
    expect(a.textContent).toContain("4");
    expect(b.textContent).toContain("—");
    for (const li of [a, b]) expect(li.textContent).not.toMatch(/기한 경과|AI|녹음/);
    // 후속 기한이 지난 행의 배경 신호는 남긴다('후속' 열만 걷었다) — 기한이 없거나 끝난 행은 칠하지 않는다.
    expect(a.querySelector("a")!.className).toContain("bg-danger-soft");
    const { container: calm } = render(<ConsultationList items={[row({ followUpDate: null, followUpAction: null })]} size={30} pageSizeKey="t" classOn ratings={null} />);
    expect(calm.querySelector("li a")!.className).not.toContain("bg-danger-soft");
  });

  it("오른쪽 블록 트랙 수 = 머리 칸 수 = 행 칸 수(평점 열 유무 · 반 열 유무 모든 조합)", () => {
    for (const ratingOn of [true, false]) for (const classOn of [true, false]) {
      const { container, unmount } = render(<ConsultationList items={[row()]} size={30} pageSizeKey="t" classOn={classOn} ratings={ratingOn ? new Map([["c1", rating]]) : null} />);
      const head = container.querySelector("[data-list-header] .-col-end-1")!;
      const body = container.querySelector("li a > div.-col-end-1")!;
      expect(head.children.length, `머리 ${ratingOn}/${classOn}`).toBe(ratingOn ? 3 : 2);
      expect(body.children.length, `행 ${ratingOn}/${classOn}`).toBe(ratingOn ? 3 : 2);
      const vars = (container.querySelector("ul") as HTMLElement).style;
      expect(vars.getPropertyValue("--right")).toBe(ratingOn ? "6.25rem 3.25rem 4rem" : "6.25rem 3.25rem"); // 날짜 · 카테고리 · 상담 평점
      unmount();
    }
  });
});
