"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  listClassTransferRoster,
  listTransferSourceClasses,
} from "@/features/enrollments/server/transfer-source-actions";
import type { MovableEnrollment } from "@/features/enrollments/server/movable-actions";
import type { TransferCandidate } from "@/features/enrollments/bulk-transfer";
import {
  orderTransferSourceClasses,
  transferRosterChoices,
  type TransferSourceClass,
} from "@/features/enrollments/transfer-roster";

const EMPTY = {
  classes: null as TransferSourceClass[] | null,
  classesError: null as string | null,
  classId: "",
  roster: null as TransferCandidate[] | null,
  /** 이 명단이 **어느 반 것인가** — 반을 빠르게 바꿔도 앞 반의 명단(=남의 수강 id)을 쓰지 않는다. */
  rosterFor: "",
  rosterError: null as string | null,
  enrollmentId: "",
};

/**
 * 반 상세 '학생 배정' 창의 반이동 — **옮겨 올 반을 먼저, 그 반 명단에서 학생을 그다음**(원장 2026-10-01).
 * 결과(`source`)는 학생 기준 흐름의 출발지(`MovableEnrollment`)와 같은 모양이라 저장은 종전 그대로 간다.
 *
 * 🔴 늦게 온 옛 응답은 버린다(요청 번호) — 반 A→B로 바꿨는데 A 명단이 늦게 오면 B 화면에 A 학생이 선다.
 * 🔴 조회는 **이벤트에서** 시작한다(토글 켬·반 고름) — effect에서 부르지 않는다(#25).
 */
export function useClassFirstTransfer({
  targetClassId,
  targetSubject,
  date,
  allowedStudentIds,
}: {
  targetClassId: string;
  targetSubject: string;
  date: string;
  allowedStudentIds: ReadonlySet<string>;
}) {
  const [s, setS] = useState(EMPTY);
  const classRequest = useRef(0);
  const rosterRequest = useRef(0);

  /** 토글을 켤 때 — 선택은 처음부터. 반 목록은 이번에 연 창에서 받은 적이 없을 때만 부른다. */
  const start = () => {
    rosterRequest.current += 1;
    const cached = s.classes !== null && !s.classesError ? s.classes : null;
    setS({ ...EMPTY, classes: cached });
    if (cached) return;
    const token = ++classRequest.current;
    const settle = (classes: TransferSourceClass[], error: string | null) => {
      if (classRequest.current !== token) return;
      setS((prev) => ({ ...prev, classes, classesError: error }));
    };
    void listTransferSourceClasses(targetClassId).then(
      (r) => (r.ok ? settle(r.items, null) : settle([], r.error)),
      () => settle([], "반 목록을 불러오지 못했습니다. 다시 시도해 주세요."),
    );
  };

  /** 창을 다시 열 때 — 걸어 둔 조회까지 무효로 만든다. */
  const reset = useCallback(() => {
    classRequest.current += 1;
    rosterRequest.current += 1;
    setS(EMPTY);
  }, []);

  /** 🔴 반을 바꾸면 고른 학생을 **반드시 비운다** — 안 비우면 앞 반의 수강 id로 이동이 나간다. */
  const pickClass = (classId: string) => {
    const token = ++rosterRequest.current;
    setS((prev) => ({ ...prev, classId, roster: null, rosterFor: "", rosterError: null, enrollmentId: "" }));
    if (!classId) return;
    const settle = (roster: TransferCandidate[], error: string | null) => {
      if (rosterRequest.current !== token) return;
      setS((prev) => ({ ...prev, roster, rosterFor: classId, rosterError: error }));
    };
    void listClassTransferRoster(classId).then(
      (r) => (r.ok ? settle(r.items, null) : settle([], r.error)),
      () => settle([], "학생 목록을 불러오지 못했습니다. 반을 다시 선택해 주세요."),
    );
  };

  const pickEnrollment = (enrollmentId: string) => setS((prev) => ({ ...prev, enrollmentId }));

  const classes = useMemo(
    () => (s.classes ? orderTransferSourceClasses(s.classes, targetClassId, targetSubject) : null),
    [s.classes, targetClassId, targetSubject],
  );
  const sourceClass = classes?.find((c) => c.id === s.classId) ?? null;
  const rosterReady = !!s.classId && s.roster !== null && s.rosterFor === s.classId;
  const roster = rosterReady ? s.roster ?? [] : [];
  const { choices } = transferRosterChoices(roster, date, allowedStudentIds);
  /**
   * 🔴 고른 학생(출발지)은 **걸러진 목록이 아니라 받아 둔 명단**에서 찾는다 — 단체 반 이동이 일부 성공하면
   *    `router.refresh()`로 배정 후보(`studentOptions`)에서 그 학생이 빠지는데, 걸러진 목록에서 찾으면 출발지가
   *    사라져 단체 이동의 결과·잠금까지 함께 날아간다(적대 리뷰 2026-10-01). 날짜를 바꿔 그날 명단에서
   *    빠진 경우도 출발지는 남기고, **한 명 이동만** `chosenEligible`로 막는다(단체 이동은 학생별로 따로 막는다).
   */
  const chosen = roster.find((c) => c.id === s.enrollmentId) ?? null;
  const chosenEligible = !!chosen && choices.some((c) => c.id === chosen.id);
  // '목록에서 뺐습니다' 수에는 **목록에 이름을 남긴** 그 학생을 넣지 않는다(남겨 두고 뺐다고 세면 거짓말).
  const { reserved, unassignable, upcoming } = transferRosterChoices(
    chosen && !chosenEligible ? roster.filter((c) => c !== chosen) : roster,
    date,
    allowedStudentIds,
  );
  const source: MovableEnrollment | null =
    chosen && sourceClass
      ? {
          enrollmentId: chosen.id,
          classId: sourceClass.id,
          className: sourceClass.className,
          subject: sourceClass.subject,
          startDate: chosen.snapshot.startDate,
          endDate: chosen.snapshot.endDate,
          attendanceDays: chosen.snapshot.attendanceDays,
        }
      : null;

  return {
    classes,
    classesError: s.classesError,
    classId: s.classId,
    enrollmentId: s.enrollmentId,
    loadingRoster: !!s.classId && !rosterReady,
    rosterError: rosterReady ? s.rosterError : null,
    choices,
    reserved,
    unassignable,
    upcoming,
    chosen,
    chosenEligible,
    source,
    start,
    reset,
    pickClass,
    pickEnrollment,
  };
}

export type ClassFirstTransfer = ReturnType<typeof useClassFirstTransfer>;
