"use client";

import { SearchableSelect } from "@/components/ui/searchable-select";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { isTransferDate } from "@/features/enrollments/bulk-transfer";
import { candidateMeta } from "@/features/enrollments/bulk-assign";
import type { ClassFirstTransfer } from "./use-class-first-transfer";

/**
 * 반 상세 '학생 배정' 창의 반이동 출발지 — **① 어느 반에서 옮기나요 → ② 그 반의 학생**(원장 2026-10-01
 * *"반이동시에 학생이름을 먼저 고르지 않고 반을 골라서 할 수 있게 먼저 하는게 나을듯. 순서상으로도."*).
 * 반을 고르기 전엔 학생 칸이 잠겨 있고, 학생 목록은 **반이동 날짜 기준 그 반 명단**이다(날짜를 바꾸면 다시 계산).
 * 열 맞춤은 종전 출발지 목록과 같다(이름 | 과목 | … — 원장 2026-09-18).
 */
export function EnrollmentClassFirstTransferPicker({
  flow,
  date,
  locked,
  bulkOn,
  onPickStudent,
}: {
  flow: ClassFirstTransfer;
  date: string;
  /** 단체 반 이동이 일부 끝났거나 결과를 모를 때 — 출발지를 바꾸지 못하게 잠근다. */
  locked: boolean;
  /** 단체 반 이동이 켜져 있으면 학생별 판정은 그쪽 목록이 한다(아래 '한 명 이동 불가' 안내를 띄우지 않는다). */
  bulkOn: boolean;
  /** 학생을 고르면 그 학생 id — 토글을 끄고 새 배정으로 넘어가도 같은 학생이 남게. */
  onPickStudent: (studentId: string) => void;
}) {
  const subjects = useSubjectMaps();
  const dateOk = isTransferDate(date);
  // 고른 학생이 이동일·배정 후보 판정에서 빠져도 **이름은 남긴다**(사라지면 무엇이 골라져 있는지 모른다).
  const stale = flow.chosen && !flow.chosenEligible ? flow.chosen : null;
  const listed = stale ? [...flow.choices, stale] : flow.choices;
  const studentReady = !!flow.classId && !flow.loadingRoster && !flow.rosterError && dateOk && listed.length > 0;
  const studentPlaceholder = !flow.classId
    ? "먼저 반을 선택해 주세요."
    : flow.loadingRoster
      ? "학생 목록을 불러오는 중…"
      : flow.rosterError
        ? "학생 목록을 불러오지 못했습니다"
        : !dateOk
          ? "반이동 날짜를 먼저 정해 주세요."
          : listed.length === 0
            ? "옮길 수 있는 학생이 없습니다"
            : "학생 선택...";
  const excluded = [
    flow.reserved > 0 ? `반이동이 이미 걸린 ${flow.reserved}명` : "",
    flow.unassignable > 0 ? `이 반에 이미 있거나 배정할 수 없는 ${flow.unassignable}명` : "",
    flow.upcoming > 0 ? `이동일 뒤에 수업을 시작하는 ${flow.upcoming}명` : "",
  ].filter(Boolean);

  return (
    <fieldset disabled={locked} className="min-w-0 space-y-3">
      <div className="space-y-1.5">
        <label className="text-foreground block text-sm font-medium">어느 반에서 옮기나요</label>
        {flow.classes === null ? (
          <p className="text-muted-foreground text-xs">반 목록을 불러오는 중…</p>
        ) : flow.classesError ? (
          <p className="text-chart-4 text-xs">{flow.classesError}</p>
        ) : flow.classes.length === 0 ? (
          <p className="text-chart-4 text-xs">옮겨 올 수 있는 다른 반이 없습니다.</p>
        ) : (
          <SearchableSelect
            value={flow.classId}
            onValueChange={flow.pickClass}
            placeholder="기존 반 선택..."
            searchPlaceholder="반 이름·과목 검색..."
            // 같은 과목 반이 먼저 선다(orderTransferSourceClasses). 반이 수백이어도 훑을 수 있게 넉넉히(#84).
            cap={300}
            sideColumns={{ hint: "w-16 text-left", meta: "w-20 text-left" }}
            options={flow.classes.map((c) => ({
              value: c.id,
              label: c.className,
              hint: subjects.labelOf(c.subject),
              meta: c.teacherName ?? "",
            }))}
          />
        )}
      </div>
      <div className="space-y-1.5">
        <label className="text-foreground block text-sm font-medium">학생 선택</label>
        <fieldset disabled={!studentReady} className={`min-w-0 ${studentReady ? "" : "opacity-60"}`}>
          <SearchableSelect
            value={flow.enrollmentId}
            onValueChange={(id) => {
              flow.pickEnrollment(id);
              const picked = flow.choices.find((c) => c.id === id);
              if (picked) onPickStudent(picked.snapshot.studentId);
            }}
            placeholder={studentPlaceholder}
            searchPlaceholder="학생 이름·학교·학년 검색..."
            cap={300}
            sideColumns={{ hint: "w-24 text-left", meta: "num w-24 text-left" }}
            options={(studentReady ? listed : []).map((c) => ({
              value: c.id,
              label: c.name,
              hint: [candidateMeta(c), c.snapshot.onHold ? "휴원" : "", c === stale ? "이동 불가" : ""]
                .filter(Boolean)
                .join(" · "),
              meta: `${c.snapshot.startDate}~`,
            }))}
          />
        </fieldset>
        {flow.rosterError ? <p className="text-chart-4 text-xs">{flow.rosterError}</p> : null}
        {stale && dateOk && !bulkOn && !locked ? (
          <p className="text-chart-4 text-xs">
            {stale.name} 학생은 <span className="num">{date}</span> 기준으로 이 반에서 옮길 수 있는 학생이 아닙니다 —
            날짜를 바꾸거나 학생을 다시 선택해 주세요.
          </p>
        ) : null}
        {studentReady && excluded.length > 0 ? (
          <p className="text-muted-foreground text-xs">{excluded.join(" · ")}은 목록에서 뺐습니다.</p>
        ) : null}
        {flow.classId && !flow.loadingRoster && !flow.rosterError && dateOk && flow.choices.length === 0 && !stale ? (
          <p className="text-chart-4 text-xs">
            <span className="num">{date}</span> 기준으로 이 반에서 옮길 수 있는 학생이 없습니다
            {excluded.length > 0 ? `(${excluded.join(" · ")})` : ""}.
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}
