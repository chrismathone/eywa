/**
 * **배정된 반** — 상담이 끝난 뒤 등록상담 상세의 맨 윗자리를 가져가는 카드(원장 2026-09-10:
 * *"어떤 반에 배정했는지 배정된 반 정보가 뜨는게 현실적이겠네"* · *"중요한건 배정된 반이니까"*).
 *
 * 이 카드가 서면 그 자리에 있던 '상담 준비 브리프'는 **아래로 내려가 '지난 상담 브리프'가 된다**
 * (감추는 게 아니라 자리를 바꾼 것 — 인쇄물 동결 스냅샷은 그대로 남는다).
 *
 * 🔴 **판정을 여기서 새로 하지 않는다.** 배정 여부는 칸반 표식과 같은 파생값(연결 학생의 미종료
 *    수강 ≥ 1)이고, 행은 그 셈과 **같은 필터**를 타는
 *    [`getAssignedClasses`](@/features/enrollment/server/assigned-classes)가 만든다.
 * 🔴 **조회 실패와 '배정 없음'을 다른 문장으로 적는다** — 실패를 "배정 없음"으로 적으면 이미 반이
 *    있는 학생을 데스크가 한 번 더 배정한다.
 */
import { GraduationCap, ExternalLink, AlertCircle } from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { assignedPanelState } from "@/features/enrollment/detail-panels";
import type { AssignedClasses } from "@/features/enrollment/server/assigned-classes";

export function AssignedClassesSection({
  assigned,
  hasStudent,
  canOpenClass,
  subjectLabel,
}: {
  assigned: AssignedClasses;
  /** 학생 연결 여부 — 연결 전이면 "배정이 없다"가 아니라 "아직 학생이 없다"가 사실이다. */
  hasStudent: boolean;
  /**
   * 반 상세를 열 수 있는 사람인가. 🔴 못 여는 사람에게 링크를 걸면 눌러도 권한 화면으로 튕기는
   * 죽은 링크가 된다 — 상담사(counselor)는 등록상담 full이지만 **수업목록이 none**이라 실제로 이 경우다.
   */
  canOpenClass: boolean;
  /**
   * 이 상담의 과목(한글 라벨). 있으면 **그 과목 수강만** 세는 필터가 걸려 있으므로 빈 목록 문구가
   * "수강이 없다"가 아니라 "이 과목 반이 없다"여야 한다(수학은 다니는데 영어 상담일 수 있다).
   */
  subjectLabel: string | null;
}) {
  return (
    <section className="border-line bg-card space-y-3 rounded-2xl border p-5">
      <header className="flex items-center gap-2">
        <GraduationCap className="text-green size-4" />
        <h2 className="text-foreground text-sm font-bold">배정된 반</h2>
        {assigned.ok && assigned.rows.length > 0 ? (
          <span className="bg-green-soft text-green rounded-md px-1.5 py-0.5 text-xs font-medium">
            <span className="num">{assigned.rows.length}</span>개 반
          </span>
        ) : null}
      </header>

      <Body
        assigned={assigned}
        hasStudent={hasStudent}
        canOpenClass={canOpenClass}
        subjectLabel={subjectLabel}
      />
    </section>
  );
}

function Body({
  assigned,
  hasStudent,
  canOpenClass,
  subjectLabel,
}: {
  assigned: AssignedClasses;
  hasStudent: boolean;
  canOpenClass: boolean;
  subjectLabel: string | null;
}) {
  // 갈래 판정은 순수 함수 단일 소스(detail-panels) — 화면에서 조건을 다시 짜면 실패가 '배정 없음'으로
  // 뭉개지는 순간을 테스트가 못 잡는다.
  const state = assignedPanelState({
    ok: assigned.ok,
    hasStudent,
    count: assigned.ok ? assigned.rows.length : 0,
  });

  // ① 조회 실패 — 원문(영문 PostgREST 메시지)은 툴팁으로만 내보낸다(화면 본문은 한글).
  if (state === "error") {
    return (
      <p
        className="text-destructive inline-flex items-center gap-1.5 text-sm break-keep"
        title={assigned.ok ? undefined : assigned.error}
      >
        <AlertCircle className="size-4 shrink-0" />
        배정된 반을 불러오지 못했습니다 — 잠시 후 다시 열어 주세요. (배정이 없다는 뜻이 아닙니다)
      </p>
    );
  }

  // ② 학생 연결 전 — 배정할 대상 자체가 아직 없다.
  if (state === "no-student") {
    return (
      <p className="text-text-dim text-sm break-keep">
        아직 학생으로 전환되지 않은 상담입니다. 위쪽 <b className="text-foreground">‘수업 배정’</b>으로
        학생을 만들고 반을 배정하면 여기에 표시됩니다.
      </p>
    );
  }

  // ③ 학생은 있는데 (이 상담 과목의) 수강이 없다.
  // ⚠️ 헤더 버튼은 이미 학생이 생긴 건이라 '학생 정보 보기'로 바뀌어 있다 — 없는 버튼을
  //    가리키지 않게 배정하는 자리(학생 상세 '수업' 탭)를 적는다.
  if (state === "empty" || !assigned.ok) {
    return (
      <p className="text-text-dim text-sm break-keep">
        {subjectLabel ? `아직 ${subjectLabel} 반이 배정되지 않았습니다.` : "아직 배정된 반이 없습니다."} 학생
        상세의 <b className="text-foreground">‘수업’</b> 탭에서 반을 배정하면 여기에 표시됩니다.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {assigned.rows.map((c) => {
        const meta = [c.teacherName ? `담임 ${c.teacherName}` : null].filter(Boolean) as string[];
        return (
          <li
            key={c.enrollmentId}
            className="border-line bg-bg-soft/40 flex flex-col gap-1 rounded-lg border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              {canOpenClass ? (
                <WindowLink
                  href={`/classes/${c.classId}`}
                  title={c.className}
                  className="text-foreground hover:text-primary inline-flex items-center gap-1 text-sm font-bold break-keep hover:underline"
                >
                  {c.className}
                  <ExternalLink className="text-text-faint size-3.5 shrink-0" />
                </WindowLink>
              ) : (
                <span className="text-foreground text-sm font-bold break-keep">{c.className}</span>
              )}
              <span className="text-text-dim text-xs break-keep">{c.subjectLabel}</span>
              {meta.length > 0 ? (
                <span className="text-text-dim text-xs break-keep">· {meta.join(" · ")}</span>
              ) : null}
              {c.onHold ? (
                <span className="bg-amber-soft text-amber rounded px-1.5 py-0.5 text-xs font-medium">휴원</span>
              ) : null}
            </div>
            {/* 요일/교시 — 라벨은 학원설정(과목별 교시표)이 만든 값이다. 세 갈래를 섞지 않는다:
                교시가 있으면 그대로 · 없으면 "시간 미정"(0교시라고 지어내지 않는다) ·
                🔴 **못 읽었으면 "시간 확인 불가"**(모르는 것을 "미정"이라고 단정하지 않는다). */}
            <div className="flex shrink-0 flex-wrap gap-x-2 gap-y-0.5 sm:justify-end">
              {c.schedule === null ? (
                <span className="text-text-faint text-xs" title="시간표 조회에 실패했습니다">
                  시간 확인 불가
                </span>
              ) : c.schedule.length > 0 ? (
                c.schedule.map((g) => (
                  <span key={`${g.days.join("")}-${g.label}`} className="text-foreground text-xs break-keep">
                    <span className="font-semibold">{g.days.join("·")}</span>{" "}
                    <span className="num">{g.label}</span>
                  </span>
                ))
              ) : (
                <span className="text-text-faint text-xs">시간 미정</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
