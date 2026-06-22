import { EyIcon } from "@/components/icons/eywa-icons";
import { SUBJECT_SOFT, type SubjectMaps } from "@/features/owner/subjects";
import { buildRichCardGroups, type GridSlot } from "@/features/timetable/lib/class-grid";
import type { PeriodsConfig } from "@/features/timetable/lib/periods";
import { RichCardGroupBoard } from "./rich-card-group";

/**
 * 통합뷰 = ijw EnglishClassTab "반=열 리치 그리드" 이식. 시작 교시별 섹션마다:
 * 좌측 고정 라벨열(수업명/담임/강의실/교시/재원/대기/퇴원) + 반=열 카드(요일×교시 미니그리드 — 셀마다 강사/LAB).
 * 교시 정렬은 평일 기준, 주말 전용 반은 "주말" 섹션. 읽기전용(편집은 기본뷰). 과목칩=과목 전환.
 * 빌드는 서버(순수), 보드 렌더는 클라(DragScrollArea). 과목색은 SubjectMaps→plain 클래스로만 클라에 전달([[#61]]).
 */
export function RichGridView({
  slots,
  subjectMaps,
  config,
}: {
  slots: GridSlot[];
  subjectMaps: SubjectMaps;
  config: PeriodsConfig;
}) {
  const groups = buildRichCardGroups(slots, config);
  const total = groups.reduce((n, g) => n + g.cards.length, 0);
  const subjectSoftClass = SUBJECT_SOFT[subjectMaps.colorOf(slots[0]?.subject ?? "")];

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
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
          </div>
          <RichCardGroupBoard group={g} subjectSoftClass={subjectSoftClass} />
        </section>
      ))}
    </div>
  );
}
