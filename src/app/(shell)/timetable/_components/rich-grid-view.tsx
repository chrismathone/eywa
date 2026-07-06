import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { SUBJECT_SOFT, type SubjectMaps } from "@/features/owner/subjects";
import { buildRichCardGroups, WEEKEND_ORDER, type GridSlot, type TeacherColorMap } from "@/features/timetable/lib/class-grid";
import type { PeriodsConfig } from "@/features/timetable/lib/periods";
import { RichCardGroupBoard } from "./rich-card-group";

/**
 * 통합뷰 = ijw EnglishClassTab "반=열 리치 그리드" 이식. 시작 교시별 섹션마다:
 * 좌측 고정 라벨열(수업명/담임/강의실/교시/재원/대기/퇴원) + 반=열 카드(요일×교시 미니그리드 — 셀마다 강사/LAB).
 * 교시 정렬은 평일 기준, 주말 전용 반은 "주말" 섹션. 읽기전용(편집은 기본뷰). 과목칩=과목 전환.
 * '1시간 단위'는 **섹션 헤더별 토글**(사용자 결정 2026-07-06 — 전역 아님): 그 섹션만 사이 빈 교시 행을 숨김.
 * 빌드는 서버(순수), 보드 렌더는 클라(DragScrollArea). 과목색은 SubjectMaps→plain 클래스로만 클라에 전달([[#61]]).
 */
export function RichGridView({
  slots,
  subjectMaps,
  config,
  teacherColors,
  compactSections,
  hrefForSectionToggle,
}: {
  slots: GridSlot[];
  subjectMaps: SubjectMaps;
  config: PeriodsConfig;
  teacherColors: TeacherColorMap;
  /** 압축할 섹션(N교시 시작)의 sectionKey 집합 — 이 섹션만 '1시간 단위'로 사이 빈 교시 행 숨김. */
  compactSections: Set<number>;
  /** 섹션 토글 href — 그 sectionKey를 압축 집합에 넣고/빼는 URL(읽기전용이라 상태는 URL 파라미터). */
  hrefForSectionToggle: (sectionKey: number) => string;
}) {
  const groups = buildRichCardGroups(slots, config, compactSections);
  const total = groups.reduce((n, g) => n + g.cards.length, 0);
  const subjectSoftClass = SUBJECT_SOFT[subjectMaps.colorOf(slots[0]?.subject ?? "")];

  return (
    // ⚠️ 자체 overflow-y-auto 금지 — 셸 스크롤과 중첩돼 우측 이단 스크롤바가 생긴다(2026-07-06).
    // 세로 스크롤은 바깥(셸) 하나만: 명단 섹션이 고정 행수(재원12·대기3·퇴원5)로 캡되어 그룹 높이가
    // 유계라, 그룹들이 자연 문서 흐름으로 쌓이고 넘침은 셸이 스크롤한다.
    <div className="space-y-4">
      <div className="text-text-faint text-right font-mono text-[11px]">
        읽기 전용 · {total}개 수업 · 편집은 기본뷰
      </div>
      {groups.map((g) => (
        <section key={g.key} className="border-line bg-card shadow-card w-max max-w-full overflow-hidden rounded-xl border">
          <div className="bg-ink text-background flex items-center gap-2 px-4 py-1.5 text-[12px] font-bold">
            <EyIcon name="rings" size={13} className="shrink-0" />
            <span className="whitespace-nowrap">{g.label}</span>
            <span className="bg-background/20 rounded-[4px] px-1.5 py-0.5 text-[10px] font-normal whitespace-nowrap">
              {g.cards.length}개 수업
            </span>
            {/* 섹션별 '1시간 단위' 토글 — 이 시작 교시 섹션만 사이 빈 교시 행을 숨긴다(전역 아님).
                주말 섹션은 교시 체계가 없어 압축 대상 아님 → 토글 숨김. */}
            {g.sectionKey !== WEEKEND_ORDER ? (
              <Link
                href={hrefForSectionToggle(g.sectionKey)}
                aria-pressed={g.compacted}
                className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-[10px] font-normal whitespace-nowrap transition ${
                  g.compacted
                    ? "border-background/40 bg-background/20 text-background"
                    : "border-background/25 text-background/70 hover:bg-background/10 hover:text-background"
                }`}
              >
                <span
                  className={`flex size-3 items-center justify-center rounded-[2px] border text-[8px] leading-none ${
                    g.compacted ? "border-background bg-background text-ink" : "border-background/50"
                  }`}
                >
                  {g.compacted ? "✓" : ""}
                </span>
                1시간 단위
              </Link>
            ) : null}
          </div>
          <RichCardGroupBoard group={g} subjectSoftClass={subjectSoftClass} teacherColors={teacherColors} />
        </section>
      ))}
    </div>
  );
}
