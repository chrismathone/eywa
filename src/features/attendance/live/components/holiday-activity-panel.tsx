/**
 * 휴원일에 **실제로 입력된 것** — 읽기 전용 목록(오늘 출결 휴원일 화면 · 강사 출결 모드).
 *
 * 🔴 여기엔 분모가 없다 — "N명 중 M명"·완료율·'완료'를 그리지 않는다. 학원설정 휴원일엔 예정 명단을 만들지 않으므로
 *    보여 줄 수 있는 사실은 "입력된 출결 N명 · M개 반"과 "보강 예약 K건"뿐이다.
 * 🔴 입력·수정 버튼이 없다(새 쓰기 경로 0). 사무실 범위에만 일별 출석부 링크를 걸고, 강사 범위는 월별 출석부로 보낸다 —
 *    일별 출석부의 기록 목록은 강사 범위로 좁혀지지 않는다.
 * ⚠️ 서버 컴포넌트 — 이름 목록은 이 화면을 볼 수 있는 범위(사무실 = 지점 전체 · 강사 = 자기 반)로 이미 좁혀져 온다.
 */
import { EmbedLink } from "@/components/embed-link";
import { attendanceLabelOf } from "@/features/class-sheets/lib/attendance-label";
import type { ScopedHolidayActivity } from "@/features/attendance/server/holiday-activity";
import { hasHolidayActivity } from "@/features/attendance/holiday-activity";
import { sheetT, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";

export function HolidayActivityPanel({
  activity,
  date,
  lang = "ko",
  labelOf,
  classNameOf = (name) => name,
}: {
  /** null = 조회 실패 — "0명"이 아니라 못 불러왔다고 적는다. */
  activity: ScopedHolidayActivity | null;
  date: string;
  lang?: SheetLang;
  /** 과목 라벨(학원설정 단일 소스 — `buildSubjectMaps().labelOf`). */
  labelOf: (subject: string) => string;
  /** 반 이름 표기(강사뷰 영어 화면은 `classNameFor`). */
  classNameOf?: (name: string) => string;
}) {
  if (!activity) {
    return (
      <p className="border-line text-text-dim bg-card rounded-2xl border px-5 py-4 text-sm break-keep">
        {sheetT(lang, "att.holiday.loadFailed")}
      </p>
    );
  }
  // 기록도 예약도 없으면 휴원일 안내만 남긴다(그 전과 같은 화면).
  if (!hasHolidayActivity(activity)) return null;

  const month = date.slice(0, 7);
  return (
    <section className="bg-card border-line space-y-3 rounded-2xl border p-5" aria-label={sheetT(lang, "att.holiday.listTitle")}>
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-foreground text-sm font-bold">{sheetT(lang, "att.holiday.listTitle")}</h2>
          <p className="text-text-dim mt-0.5 text-xs break-keep">
            {sheetTf(lang, "att.holiday.counts", { students: activity.students, classes: activity.classes })}
            {activity.reservations > 0
              ? ` · ${sheetTf(lang, "att.holiday.reservations", { n: activity.reservations })}`
              : ""}
            {` · ${sheetT(lang, activity.officeScope ? "att.holiday.scope.all" : "att.holiday.scope.mine")}`}
          </p>
        </div>
        {activity.officeScope ? (
          <EmbedLink
            href={`/attendance/${date}`}
            className="bg-primary-soft text-primary rounded-pill shrink-0 px-3 py-1.5 text-xs font-bold"
          >
            {sheetT(lang, "att.holiday.openDaily")}
          </EmbedLink>
        ) : (
          <EmbedLink
            href={`/attendance?month=${month}`}
            className="bg-primary-soft text-primary rounded-pill shrink-0 px-3 py-1.5 text-xs font-bold"
          >
            {sheetT(lang, "att.holiday.openMonthly")}
          </EmbedLink>
        )}
      </header>

      {/* 테스트 학생을 뺀 수라 일별 출석부(테스트 학생 포함)와 그만큼 다를 수 있다 — 차이를 문구로 밝힌다. */}
      {activity.officeScope && activity.excludedTestCells > 0 ? (
        <p className="text-text-faint text-xs break-keep">
          {sheetTf(lang, "att.holiday.testNote", { n: activity.excludedTestCells })}
        </p>
      ) : null}

      <ul className="divide-border divide-y">
        {activity.rows.map((row) => (
          <li key={row.classId} className="py-2.5">
            <p className="text-foreground text-sm font-medium">
              {row.className ? classNameOf(row.className) : sheetT(lang, "att.holiday.unknownClass")}
              <span className="text-text-dim ml-1.5 text-xs font-normal">
                {row.subject ? labelOf(row.subject) : ""}
                {row.students.length > 0
                  ? `${row.subject ? " · " : ""}${sheetTf(lang, "att.holiday.classStudents", { n: row.students.length })}`
                  : ""}
              </span>
            </p>
            {row.students.length > 0 ? (
              <p className="text-text-dim mt-1 text-xs leading-relaxed break-keep">
                {row.students
                  .map((s) => {
                    const marks = s.statuses.map((st) => attendanceLabelOf(st, lang)).filter(Boolean).join("·");
                    const name = s.name ?? sheetT(lang, "att.holiday.unknownStudent");
                    return marks ? `${name}(${marks})` : name;
                  })
                  .join(", ")}
              </p>
            ) : null}
            {row.reservations.length > 0 ? (
              <p className="text-text-dim mt-1 text-xs leading-relaxed break-keep">
                <span className="text-foreground font-medium">{sheetT(lang, "att.holiday.reservedLabel")}</span>{" "}
                {row.reservations
                  .map(
                    (r) =>
                      `${r.name ?? sheetT(lang, "att.holiday.unknownStudent")} ${r.slotStart}${r.slotEnd ? `~${r.slotEnd}` : ""}`,
                  )
                  .join(", ")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
