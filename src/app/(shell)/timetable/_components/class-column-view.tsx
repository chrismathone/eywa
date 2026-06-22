import { WindowLink } from "@/components/workspace/window-link";
import { SUBJECT_SOFT, type SubjectMaps } from "@/features/owner/subjects";
import {
  buildClassCards,
  type ClassColumnSlot,
  type ClassColumnStudent,
} from "@/features/timetable/lib/class-columns";

/** 학생 행 색 — 신입=빨강·전입=초록·그 외 기본(ClassCell 톤과 동일). */
function rosterTone(s: ClassColumnStudent): string {
  if (s.isNew) return "text-danger";
  if (s.isTransferredIn) return "text-primary";
  return "text-foreground";
}

/**
 * 통합뷰 = 반(class)을 단위로 본다. 한 과목의 반을 **반응형 카드 그리드**로(좁으면 1열·넓으면 N열, auto-fill).
 * 각 카드: 과목색 헤더(반명·스케줄·강사·강의실, 클릭=반 정보 창) + 학생 명단(신입 빨강·전입 초록, 클릭=학생 창) + 정원.
 * 읽기전용(편집은 기본뷰). 과목 전환은 상위 툴바의 과목 칩으로(통합뷰도 과목별).
 * ⚠️ 옛 시작교시 그룹 + 미니그리드는 폐기 — 분절·빈 노이즈·가로스크롤로 가독성이 나빴다(class-columns.ts 주석 참고).
 */
export function ClassColumnView({
  slots,
  subjectMaps,
}: {
  slots: ClassColumnSlot[];
  subjectMaps: SubjectMaps;
}) {
  const cards = buildClassCards(slots);
  const soft = SUBJECT_SOFT[subjectMaps.colorOf(slots[0]?.subject ?? "")];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="text-text-faint mb-2 text-right font-mono text-[11px]">
        읽기 전용 · {cards.length}개 수업 · 편집은 기본뷰
      </div>
      <div className="grid items-start gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
        {cards.map((c) => (
          <div
            key={c.classId}
            className="border-line bg-card shadow-card flex flex-col overflow-hidden rounded-xl border"
          >
            {/* 헤더 — 반명·스케줄·강사·강의실 (클릭=반 정보 창), 과목색 틴트 */}
            <WindowLink
              href={`/classes/${c.classId}`}
              title={c.className}
              ariaLabel={`${c.className} 반 정보`}
              className={`block border-line border-b px-3 py-2 transition hover:brightness-95 ${soft}`}
            >
              <div className="truncate text-[14px] font-bold">{c.className}</div>
              <div className="mt-0.5 text-[11px] opacity-80">{c.scheduleLabel}</div>
              <div className="truncate text-[11px] opacity-70">
                {c.teacherName ?? "—"}
                {c.classroomName ? ` · ${c.classroomName}` : ""}
              </div>
            </WindowLink>

            {/* 학생 명단 */}
            <div className="bg-card flex-1 overflow-y-auto p-1.5" style={{ maxHeight: 240 }}>
              {c.activeCount === 0 ? (
                <div className="text-text-faint px-1 py-3 text-center text-[11px]">재원생 없음</div>
              ) : (
                c.students
                  .filter((s) => s.status === "active")
                  .map((s, i) => <RosterRow key={s.studentId ?? `s-${i}`} s={s} />)
              )}
            </div>

            {/* 정원 */}
            <div className="text-text-faint border-line border-t px-3 py-1 text-right font-mono text-[11px]">
              {c.activeCount}명
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RosterRow({ s }: { s: ClassColumnStudent }) {
  const meta = [s.school, s.grade].filter(Boolean).join(" ");
  const tone = rosterTone(s);
  const inner = (
    <>
      <span className="truncate">{s.name}</span>
      {meta ? <span className="text-text-faint shrink-0 font-mono text-[9px]">{meta}</span> : null}
    </>
  );
  const cls = `flex items-baseline justify-between gap-1 px-1 py-px text-[11px] leading-tight ${tone}`;
  if (s.studentId) {
    return (
      <WindowLink
        href={`/students/${s.studentId}`}
        title={s.name}
        ariaLabel={`${s.name} 학생 정보`}
        className={`${cls} hover:bg-bg-soft`}
      >
        {inner}
      </WindowLink>
    );
  }
  return <div className={cls}>{inner}</div>;
}
