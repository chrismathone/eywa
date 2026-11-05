"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { kstToday } from "@/lib/date-kst";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, UserPlus, X } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { conflictToast } from "@/lib/ui/conflict-toast";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { enrollmentPeriodsOverlap } from "@/features/enrollments/eligibility";
import {
  createEnrollment,
  moveEnrollmentsBatch,
  type CreateEnrollmentState,
} from "@/features/enrollments/server/actions";
import {
  listMovableEnrollments,
  type MovableEnrollment,
} from "@/features/enrollments/server/movable-actions";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";
import { BulkAssignFailures, EnrollmentBulkPicker } from "@/components/enrollment-bulk-picker";
import { useBulkAssign } from "@/components/use-bulk-assign";
import { useBulkTransfer } from "@/components/use-bulk-transfer";
import { EnrollmentTransferPicker } from "@/components/enrollment-transfer-picker";
import { useClassFirstTransfer } from "@/components/use-class-first-transfer";
import { EnrollmentClassFirstTransferPicker } from "@/components/enrollment-class-first-transfer-picker";
import { isTransferDate, TRANSFER_UNKNOWN } from "@/features/enrollments/bulk-transfer";

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABEL: Record<string, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

export type AssignDialogStudent = {
  id: string;
  name: string;
  grade: string | null;
  /** 단체 배정 목록의 학교·학년 표기·검색용(반 상세만 싣는다). */
  school?: string | null;
};

export type AssignDialogClass = {
  id: string;
  className: string;
  subject: string;
  teacherName: string | null;
  studentCount: number;
  /** 특강 토글값(0133a) — 반 이동 다이얼로그의 특강 기본 숨김용. 판정은 isSpecialLecture(이름 폴백 포함). */
  isSpecial?: boolean;
  /** 반 운영 요일(분리등원 후보). 없으면 등원 요일 선택 미표시. */
  days?: string[];
  /** 스케줄 요약("월·목 14:20") — 반 옵션에서 무슨 요일·몇 시인지 표시. */
  scheduleLabel?: string;
  /**
   * 이 학생이 **이 반에 이미 가진 수강 기간**(지난 것 포함). DB GiST가 같은 (학생,반)에 기간이 겹치는
   * 배정을 거부하므로, 저장을 눌러 실패하기 전에 화면에서 미리 알려주려고 받는다.
   * 미지정이면 사전 경고 없이 서버 메시지에 맡긴다(반→학생 모드).
   */
  existingPeriods?: { start: string; end: string | null }[];
};

function Submit({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
      배정
    </Button>
  );
}

/** 반이동 기본 적용일 = **내일** — 학생 상세 '반 이동' 창(`MoveEnrollmentButton`)과 같은 기본값. */
function tomorrowOf(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** "2026-08-04" → "2026-08-04부터" / 종료가 있으면 "2026-08-04 ~ 2026-08-31". */
function periodLabel(e: { start: string; end: string | null }): string {
  return e.end ? `${e.start} ~ ${e.end}` : `${e.start}부터`;
}

/**
 * 수강 배정 모달. 두 가지 모드:
 * - mode="add-class-to-student": 학생 정보가 고정, 반 목록에서 선택
 * - mode="add-student-to-class": 반 정보가 고정, 학생 목록에서 선택
 */
export function EnrollmentAssignDialog({
  open,
  onClose,
  mode,
  student,
  classes,
  studentOptions,
  fixedClass,
  conflicts,
  allowTransfer = true,
}: {
  open: boolean;
  onClose: (assigned: boolean) => void;
  mode: "add-class-to-student" | "add-student-to-class";
  student?: AssignDialogStudent;
  classes?: AssignDialogClass[];
  studentOptions?: AssignDialogStudent[];
  fixedClass?: AssignDialogClass;
  conflicts?: { day: string; time: string; existingClass: string }[];
  /**
   * '반이동' 토글을 그릴지 — 서버 `moveEnrollmentsBatch`·`listMovableEnrollments`·`transfer-source-actions`와
   * 같은 판정(`canManageTenant(role, "classes")`)을 page.tsx가 계산해 내린다(원장 2026-11-05 — lib/write-lock.ts).
   * 배정 창은 students full로도 열리므로(createEnrollment = classes full ∥ students full) 수업목록이 '읽기'인
   * 사람에게 토글이 떠서 누르면 거절됐다. 기본값 true = 이 값을 아직 안 내리는 호출처의 종전 동작.
   */
  allowTransfer?: boolean;
}) {
  const router = useRouter();
  const subjects = useSubjectMaps();
  const [state, formAction] = useActionState<CreateEnrollmentState, FormData>(
    createEnrollment,
    undefined,
  );
  const isStudentMode = mode === "add-class-to-student";
  // 일부 학생 이동 뒤 배경이 갱신돼도 선택한 목적지/요일을 잃지 않는다.
  // 다시 열 때는 최신 반 목록을 사용한다. 저장 시 유효성은 서버에서 재확인한다.
  const [classSession, setClassSession] = useState({ open, classes });
  if (classSession.open !== open) setClassSession({ open, classes });
  const dialogClasses = classSession.classes;

  // 분리등원: 대상 반의 운영 요일. student→class 모드는 드롭다운 선택 반, class→student 모드는 고정 반.
  const [selectedClassId, setSelectedClassId] = useState("");
  const selectedClass = isStudentMode
    ? dialogClasses?.find((c) => c.id === selectedClassId)
    : fixedClass;
  const targetClassDays = selectedClass?.days ?? [];
  const classDaysKey = DAY_ORDER.filter((d) => targetClassDays.includes(d)).join(",");
  // 등원 요일(=학생이 실제 가는 요일). 기본 = 반 전 요일. 대상 반이 바뀌면 그 반 전 요일로 리셋.
  // (effect 대신 "렌더 중 prev 비교 조정" 패턴 — set-state-in-effect 룰 회피, React 권장 #25.)
  const [attendingDays, setAttendingDays] = useState<string[]>(classDaysKey ? classDaysKey.split(",") : []);
  const [prevClassDaysKey, setPrevClassDaysKey] = useState(classDaysKey);
  if (classDaysKey !== prevClassDaysKey) {
    setPrevClassDaysKey(classDaysKey);
    setAttendingDays(classDaysKey ? classDaysKey.split(",") : []);
  }
  const toggleDay = (d: string) =>
    setAttendingDays((prev) => {
      const next = prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d];
      return DAY_ORDER.filter((x) => next.includes(x));
    });
  const orderedClassDays = classDaysKey ? classDaysKey.split(",") : [];

  // 수강 기간(제어 입력) — 겹침을 저장 전에 판정하려면 값을 알아야 한다.
  const today = kstToday();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");

  /**
   * ── 단체 배정(원장 2026-09-18) ── *"특강같은 수업에 단체 배정하고 싶은데"* · *"원생에서 수업 배정할때는
   * 단체배정 기능 필요없고, 수업에서 원생 배정할떄는 단체 배정 가능하게"* — **반 → 학생 모드에서만** 선다.
   * 켜면 학생 칸이 체크 목록이 되고 시작일·종료일·등원 요일은 고른 학생 모두에게 같이 간다.
   * 단체 배정과 반이동은 별도 모드다. 같은 출발 반의 여러 학생 이동은 반이동 안의 '단체 반 이동'을 쓴다.
   */
  const bulk = useBulkAssign({
    classId: isStudentMode ? null : fixedClass?.id ?? null,
    names: studentOptions ?? [],
    startDate,
    endDate,
    attendingDays,
    onDone: () => onClose(true),
  });
  const resetBulk = bulk.reset;

  /**
   * ── 반이동 예약(원장 2026-09-18) ────────────────────────────────────────────────
   * *"기존 수업이 있는 학생에게 '새로운 수강 배정'을 하려고 하는 경우 … 좌하단에 '반이동' 토글 …
   *  '배정'을 누르면 해당 날짜로 '반이동' 예약 처리 … 예를 들어 9/12 반이동이면 9/11까지 이전수업,
   *  9/12부터 새로운수업."*
   *
   * 🔴 **새 예약 인프라를 만들지 않는다** — 미래 적용일로 `moveEnrollmentsBatch`를 부르면 RPC가
   *    옛 수강 `end_date = 적용일` · 새 수강 `start_date = 적용일` · `is_transferred = true`로 짝을 만들고,
   *    학생·반 상세의 **예약 배너(`ScheduledChangeBanner`)와 '취소'가 자동으로 붙는다**
   *    (`classifyScheduled` → `cancelScheduledEnrollment`). 그래서 "예약은 언제나 취소 가능"이 저절로 성립한다.
   * 🔴 그냥 `createEnrollment`에 미래 시작일만 넣으면 **옛 반이 안 닫혀 이중 등록**이 된다 — 그게 이 토글의 이유다.
   * 🔑 경계 규약은 RPC 그대로: 적용일이 **새 수업의 첫날**이고 옛 수업은 그 전날까지다
   *    (`end_date = 적용일`은 반이동 종료라 그날은 이미 새 반 — `isEnrollmentEndedOn`과 같은 규약, [[#125]]).
   */
  const [transferMode, setTransferMode] = useState(false);
  const [transferDate, setTransferDate] = useState(() => tomorrowOf(today));
  const [fromEnrollmentId, setFromEnrollmentId] = useState("");
  const [movable, setMovable] = useState<MovableEnrollment[] | null>(null);
  /**
   * 🔴 이 후보 목록이 **어느 학생 것인가** — 학생을 빠르게 바꾸면 두 조회의 응답 순서가 뒤집혀
   *    앞 학생의 목록이 남을 수 있다. 수강 id에는 학생이 딸려 있어서, 그대로 이동하면 **남의 학생이 옮겨진다**.
   *    그래서 목록에 주인을 적어 두고 지금 고른 학생과 다르면 쓰지 않는다.
   */
  const [movableFor, setMovableFor] = useState("");
  const [movableError, setMovableError] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferPending, startTransfer] = useTransition();
  // 반→학생 모드는 학생을 창 안에서 고른다 — 그 선택이 곧 후보 조회 키다.
  const [pickedStudentId, setPickedStudentId] = useState("");
  const transferStudentId = isStudentMode ? student?.id ?? "" : pickedStudentId;
  /** 출발지 후보 = 아직 안 끝난 수강 중 **목적지가 아닌** 반(자기 반으로의 이동은 이동이 아니다). */
  const targetClassId = isStudentMode ? selectedClassId : fixedClass?.id ?? "";
  // 🔴 지금 고른 학생의 목록일 때만 쓴다(응답 순서가 뒤집혀도 남의 수강이 후보에 서지 않는다).
  const fromOptions =
    movableFor && movableFor === transferStudentId
      ? (movable ?? []).filter((m) => m.classId !== targetClassId)
      : [];
  /**
   * 반 상세(반 → 학생)의 반이동은 **옮겨 올 반을 먼저, 그 반 명단에서 학생을 그다음**에 고른다(원장 2026-10-01).
   * 학생 상세(학생 고정)는 종전 그대로 그 학생의 수강에서 출발지를 고른다. 어느 쪽이든 출발지는 같은 모양이다.
   * 🔑 "이미 이 반에 있는 학생" 막기는 종전 규칙 그대로 — 배정 후보(`studentOptions`) 밖의 학생은 고를 수 없다.
   */
  const allowedStudentIds = useMemo(() => new Set((studentOptions ?? []).map((s) => s.id)), [studentOptions]);
  const classFirst = useClassFirstTransfer({
    targetClassId: isStudentMode ? "" : fixedClass?.id ?? "",
    targetSubject: fixedClass?.subject ?? "",
    date: transferDate,
    allowedStudentIds,
  });
  const resetClassFirst = classFirst.reset;
  const fromEnrollment = isStudentMode
    ? fromOptions.find((m) => m.enrollmentId === fromEnrollmentId) ?? null
    : classFirst.source;
  const transfer = useBulkTransfer(open && transferMode ? fromEnrollment?.enrollmentId ?? "" : "", transferDate, () => onClose(true));
  const saving = transferPending || bulk.pending || transfer.pending;
  const sourceLocked = transfer.completed.length > 0 || transfer.uncertain;
  const transferSubmitting = useRef(false);

  /**
   * 후보는 **토글을 켤 때** 부른다(미리 안 싣는다 — 반 상세는 명단 전체가 후보가 되어 페이로드가 커진다).
   * 🔴 학생을 바꾸면 고른 출발지를 **반드시 비운다** — 안 비우면 남의 수강 id로 이동이 나간다.
   */
  /**
   * 🔴 **늦게 온 옛 응답은 버린다** — 학생을 A→B로 바꾸면 A 조회가 B보다 늦게 돌아올 수 있다. 버리지 않으면
   *    A 목록이 B 화면을 덮어(주인 표식 때문에 A가 옮겨지진 않지만) B로는 영영 이동을 못 한다(실측: 테스트가 잡았다).
   * 🔴 조회를 **전환(transition)에 싣지 않는다** — 걸린 조회 하나가 전환을 붙잡으면 '배정' 버튼이 그동안 잠긴다.
   */
  const latestMovableRequest = useRef("");
  const [loadingMovable, setLoadingMovable] = useState(false);
  const loadMovable = (studentId: string) => {
    latestMovableRequest.current = studentId;
    setMovable(null);
    setMovableFor("");
    setMovableError(null);
    setFromEnrollmentId("");
    if (!studentId) {
      setLoadingMovable(false);
      return;
    }
    setLoadingMovable(true);
    const settle = (items: MovableEnrollment[], error: string | null) => {
      if (latestMovableRequest.current !== studentId) return; // 옛 학생의 응답
      setLoadingMovable(false);
      setMovableError(error);
      setMovable(items);
      setMovableFor(studentId);
      const candidates = items.filter((m) => m.classId !== targetClassId);
      // 후보가 하나뿐이면 골라 둔다(대부분의 경우) — 둘 이상이면 사람이 고르게 비워 둔다.
      if (candidates.length === 1) setFromEnrollmentId(candidates[0]!.enrollmentId);
    };
    void listMovableEnrollments(studentId).then(
      (result) => (result.ok ? settle(result.items, null) : settle([], result.error)),
      () => settle([], "수강 목록을 불러오지 못했습니다"),
    );
  };
  /** 목적지 반이 바뀌면 후보에서 그 반이 빠지므로 고른 출발지가 무효가 될 수 있다 — 그때만 비운다. */
  const [prevTargetClassId, setPrevTargetClassId] = useState(targetClassId);
  if (targetClassId !== prevTargetClassId) {
    setPrevTargetClassId(targetClassId);
    if (fromEnrollmentId && !fromOptions.some((m) => m.enrollmentId === fromEnrollmentId))
      setFromEnrollmentId("");
  }
  const toggleTransfer = () => {
    const next = !transferMode;
    setTransferMode(next);
    setTransferError(null);
    if (next) {
      bulk.setMode(false);
      // 반 상세는 반부터 고르므로 반 목록을 부르고, 학생 상세는 그 학생의 수강을 부른다.
      if (isStudentMode) loadMovable(transferStudentId);
      else classFirst.start();
    }
  };
  const toggleBulk = () => {
    const next = !bulk.on;
    bulk.setMode(next);
    if (next) {
      setTransferMode(false);
      setTransferError(null);
    }
  };
  // 같은 (학생,반)에 기간이 겹치는 배정은 DB GiST가 거부한다 → **누르기 전에** 화면에서 막고 이유를 준다.
  // (겹치는데도 저장을 누르면 서버가 영문 제약 에러를 냈던 2026-07-28 제보의 근본 원인.)
  // 🔴 반이동이면 새 수강의 시작일은 **이동일**이다 — 시작일 칸을 보면 겹침 경고가 엉뚱한 날을 잰다.
  const effectiveStart = transferMode ? transferDate : startDate;
  const isoStart = /^\d{4}-\d{2}-\d{2}$/.test(effectiveStart) ? effectiveStart : null;
  const overlapping = isoStart && !transfer.on
    ? (selectedClass?.existingPeriods ?? []).filter((p) =>
        enrollmentPeriodsOverlap(p.start, p.end, isoStart, transferMode ? null : endDate || null),
      )
    : [];
  // 반 옵션에 "이미 배정됨" 힌트 — 목록에서 고르기 전에 보이게(오늘 이후로 살아있는 수강만).
  const assignedHint = (c: AssignDialogClass) => {
    const live = (c.existingPeriods ?? []).find((p) => !p.end || p.end > today);
    return live ? ` · 이미 배정됨(${periodLabel(live)})` : "";
  };

  /**
   * '배정' — 반이동 예약. 🔴 폼 액션(`createEnrollment`)을 타지 않는다(그쪽은 옛 반을 안 닫는다).
   * 🔴 서버가 게이트·과거일·겹침을 **다시** 본다([[#77]]) — 여기 판정은 누르기 전에 이유를 주려는 것일 뿐이다.
   */
  const runTransfer = () => {
    if (transferSubmitting.current) return;
    setTransferError(null);
    // 빈 배열은 목적지의 전 요일 등원이다.
    const narrowedDays =
      orderedClassDays.length > 0 && attendingDays.length > 0 && attendingDays.length < orderedClassDays.length
        ? attendingDays
        : [];
    if (transfer.on) { void transfer.run(targetClassId, narrowedDays); return; }
    if (isStudentMode && !transferStudentId) {
      setTransferError("학생을 먼저 선택해 주세요.");
      return;
    }
    if (!targetClassId) {
      setTransferError("옮겨 갈 반을 선택해 주세요.");
      return;
    }
    if (!isStudentMode && classFirst.classId && !fromEnrollment) {
      setTransferError("옮길 학생을 선택해 주세요.");
      return;
    }
    if (!fromEnrollment || (isStudentMode && movableFor !== transferStudentId)) {
      setTransferError("어느 반에서 옮길지 선택해 주세요.");
      return;
    }
    // 반 먼저 흐름: 고른 학생이 이동일 명단·배정 후보에서 빠졌으면 한 명 이동을 막는다(출발지는 남겨 둔다).
    if (!isStudentMode && !classFirst.chosenEligible) {
      setTransferError("선택한 학생은 이 날짜에 이 반에서 옮길 수 없습니다. 날짜나 학생을 다시 선택해 주세요.");
      return;
    }
    if (!isTransferDate(transferDate) || transferDate < today) {
      setTransferError("반이동 날짜는 오늘 이후로 정해 주세요.");
      return;
    }
    transferSubmitting.current = true;
    startTransfer(async () => {
      try {
      const result = await moveEnrollmentsBatch(
        [
          {
            enrollmentId: fromEnrollment.enrollmentId,
            newClassId: targetClassId,
            // 좁히지 않았으면 목적지 전 요일 등원.
            attendanceDays: narrowedDays,
          },
        ],
        transferDate,
      );
      if (result.error) {
        setTransferError(result.error);
        return;
      }
      const row = result.results?.[0];
      if (result.results?.length !== 1 || row?.enrollmentId !== fromEnrollment.enrollmentId || !row.ok) {
        setTransferError(row?.error ?? TRANSFER_UNKNOWN);
        return;
      }
      notifyTermPlansChanged();
      router.refresh();
      onClose(true);
      } catch {
        setTransferError(TRANSFER_UNKNOWN);
      } finally {
        transferSubmitting.current = false;
      }
    });
  };

  // 배정 성공 시 1회만: 배경 새로고침 + 닫기. 부모(ClassAssignAction/StudentAssignAction)가
  // 다이얼로그를 항상 마운트한 채 open만 토글하므로(언마운트 없음) useActionState state가 잔존한다.
  // handledRef에 처리한 enrollmentId를 기록해, stale state가 재오픈 렌더에서 다이얼로그를 다시
  // 닫는 것(=클릭 무반응 버그)을 막는다. 진짜 새 배정(새 UUID)일 때만 다시 발화한다.
  const handledEnrollmentId = useRef<string | null>(null);
  useEffect(() => {
    if (
      state?.enrollmentId &&
      !state.error &&
      handledEnrollmentId.current !== state.enrollmentId
    ) {
      handledEnrollmentId.current = state.enrollmentId;
      notifyTermPlansChanged();
      router.refresh();
      onClose(true);
    }
  }, [state, router, onClose]);

  // 수강 기간 겹침 등 저장 차단 경고 — 인라인 텍스트 + 가운데(top-center) 토스트 병행(제출 결과 바뀔 때만).
  const notifiedError = useRef<CreateEnrollmentState>(undefined);
  useEffect(() => {
    if (state === notifiedError.current) return;
    notifiedError.current = state;
    if (state?.error) conflictToast(state.error);
  }, [state]);
  // 배정 다이얼로그를 열 때 이미 시간 충돌이 있으면 한 번 가운데 알림(작은 인라인 박스 보완).
  const prevOpen = useRef(false);
  useEffect(() => {
    if (open && !prevOpen.current && conflicts && conflicts.length > 0) {
      conflictToast(`시간 충돌: ${conflicts.map((c) => `${c.day}요일 ${c.time}`).join(", ")}`);
    }
    prevOpen.current = open;
  }, [open, conflicts]);
  /**
   * 🔴 창을 닫았다 다시 열면 반이동 상태를 **처음으로 되돌린다** — 이 다이얼로그는 언마운트되지 않고
   *    `open`만 토글되므로(위 `handledEnrollmentId` 주석), 안 지우면 지난번에 고른 **남의 수강 id**가 남는다.
   */
  const prevOpenForReset = useRef(false);
  useEffect(() => {
    if (open && !prevOpenForReset.current) {
      setTransferMode(false);
      setTransferDate(tomorrowOf(kstToday()));
      setFromEnrollmentId("");
      setMovable(null);
      setMovableFor("");
      setMovableError(null);
      setTransferError(null);
      setPickedStudentId("");
      setLoadingMovable(false);
      resetBulk();
      resetClassFirst();
      // 닫기 전에 걸어 둔 조회가 다시 연 창을 덮지 않게 — 옛 요청을 무효로 만든다.
      latestMovableRequest.current = "";
    }
    prevOpenForReset.current = open;
  }, [open, resetBulk, resetClassFirst]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      {/* 단체 배정은 목록이 길어 작은 창에서 넘친다 — 그때만 창 안 스크롤(🔴 평소엔 안 건다: 인라인
          SearchableSelect 목록이 스크롤 상자에 잘린다). */}
      <div
        className={`bg-background border-border w-full max-w-md rounded-xl border p-6 shadow-lg ${
          bulk.on || transfer.on ? "max-h-full overflow-y-auto" : ""
        }`}
      >
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">수강 배정</p>
            <h2 className="text-foreground mt-1 text-lg font-bold">
              {isStudentMode ? (
                <>
                  {transfer.on ? `선택한 ${transfer.ids.length}명` : student?.name}
                  <span className="text-muted-foreground ml-2 text-xs font-normal">
                    {transfer.on ? "단체 반 이동" : student?.grade ?? ""}
                  </span>
                </>
              ) : (
                <>
                  {fixedClass?.className}
                  <span className="text-muted-foreground ml-2 text-xs font-normal">
                    {fixedClass ? subjects.labelOf(fixedClass.subject) : ""}
                  </span>
                </>
              )}
            </h2>
            <p className="text-muted-foreground text-xs">
              {isStudentMode
                ? "배정할 반을 선택하세요"
                : bulk.on
                  ? "배정할 학생을 여러 명 선택하세요"
                  : transferMode
                    ? "옮겨 올 반을 먼저 고르고, 그 반의 학생을 선택하세요"
                    : "배정할 학생을 선택하세요"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onClose(false)}
            disabled={saving}
            className="text-muted-foreground hover:text-foreground"
            aria-label="닫기"
          >
            <X className="size-4" />
          </button>
        </header>

        {/* 🔴 반이동 모드에선 폼 제출을 **막는다** — 날짜 칸에서 Enter를 치면 `createEnrollment`가 돌아
            옛 반을 안 닫은 새 수강이 생긴다(이 토글이 막으려던 바로 그 이중 등록). */}
        <form
          action={formAction}
          onSubmit={(e) => {
            // 단체 배정도 폼 제출(createEnrollment — 한 명용)을 타지 않는다.
            if (transferMode || bulk.on) e.preventDefault();
          }}
        >
          <fieldset disabled={saving} className="min-w-0 space-y-3">
          {isStudentMode && student ? (
            <input type="hidden" name="studentId" value={student.id} />
          ) : null}
          {!isStudentMode && fixedClass ? (
            <input type="hidden" name="classId" value={fixedClass.id} />
          ) : null}

          {isStudentMode && dialogClasses ? (
            <div className="space-y-1.5">
              <label className="text-foreground block text-sm font-medium">반 선택</label>
              <SearchableSelect
                name="classId"
                value={selectedClassId}
                onValueChange={setSelectedClassId}
                placeholder="반 선택..."
                searchPlaceholder="반 이름·과목·강사 검색..."
                // ⚠️ 기본 cap 50이면 이름순 앞을 로마자 영어반이 독점해 목록을 훑을 때 수학반이
                // 8개만 보였다(gotcha #84). 학생을 수학반에 배정하는 게 이 다이얼로그의 주 용도다.
                cap={300}
                options={dialogClasses.filter((c) => !transfer.on || c.id !== transfer.classId).map((c) => ({
                  value: c.id,
                  label: c.className,
                  hint: `${subjects.labelOf(c.subject)}${c.scheduleLabel ? ` · ${c.scheduleLabel}` : ""}${c.teacherName ? ` · ${c.teacherName}` : ""} · ${c.studentCount}명${assignedHint(c)}`,
                }))}
              />
            </div>
          ) : null}

          {!isStudentMode && studentOptions && bulk.on ? (
            <EnrollmentBulkPicker
              options={studentOptions}
              selected={bulk.ids}
              onChange={bulk.pick}
              disabled={bulk.pending}
            />
          ) : null}

          {/* 반이동일 땐 학생을 여기서 고르지 않는다 — 아래 '어느 반에서 옮기나요'를 먼저, 학생은 그 반 명단에서. */}
          {!isStudentMode && studentOptions && !bulk.on && !transferMode ? (
            <fieldset disabled={sourceLocked} className="min-w-0 space-y-1.5">
              <label className="text-foreground block text-sm font-medium">학생 선택</label>
              <SearchableSelect
                name="studentId"
                value={pickedStudentId}
                onValueChange={setPickedStudentId}
                placeholder="학생 선택..."
                searchPlaceholder="학생 이름 검색..."
                options={studentOptions.map((s) => ({
                  value: s.id,
                  label: s.name,
                  hint: s.grade ?? undefined,
                }))}
              />
            </fieldset>
          ) : null}

          {/* 🔴 반이동일 땐 **이동일 한 칸**이다 — 시작일·종료일을 함께 두면 "어느 날짜가 진짜인가"가 갈린다.
              (이동일이 곧 새 수업의 첫날이고, 옛 수업은 그 전날까지다.) */}
          {transferMode ? (
            <div className="space-y-3">
              {!isStudentMode ? (
                <EnrollmentClassFirstTransferPicker
                  flow={classFirst}
                  date={transferDate}
                  locked={sourceLocked}
                  bulkOn={transfer.on}
                  onPickStudent={(id) => {
                    setPickedStudentId(id);
                    setTransferError(null);
                  }}
                />
              ) : (
              <fieldset disabled={sourceLocked} className="min-w-0 space-y-1.5">
                <label className="text-foreground block text-sm font-medium">어느 반에서 옮기나요</label>
                {movable === null || loadingMovable ? (
                  <p className="text-muted-foreground text-xs">
                    {transferStudentId ? "기존 수업을 불러오는 중…" : "먼저 학생을 선택해 주세요."}
                  </p>
                ) : fromOptions.length === 0 ? (
                  <p className="text-chart-4 text-xs">
                    {movableError ?? "옮길 수 있는 기존 수업이 없습니다. 토글을 끄고 새 배정으로 진행해 주세요."}
                  </p>
                ) : (
                  <SearchableSelect
                    value={fromEnrollmentId}
                    onValueChange={(id) => {
                      setFromEnrollmentId(id);
                      setTransferError(null);
                    }}
                    placeholder="기존 반 선택..."
                    searchPlaceholder="반 이름 검색..."
                    // 이름 / 과목 / 날짜 **열 맞춤**(원장 2026-09-18) — 과목은 짧은 글자 열, 날짜는 시작일(`~`까지 고정 11자).
                    // ⚠️ 종료 예정일은 여기 안 싣는다(열이 넘친다) — 고르면 아래 경고가 "그날까지 늘어난다"를 따로 말한다.
                    sideColumns={{ hint: "w-16 text-left", meta: "num w-24 text-left" }}
                    options={fromOptions.map((m) => ({
                      value: m.enrollmentId,
                      label: m.className,
                      hint: m.subject ? subjects.labelOf(m.subject) : "",
                      meta: `${m.startDate}~`,
                    }))}
                  />
                )}
              </fieldset>
              )}
              {fromEnrollment ? <EnrollmentTransferPicker transfer={transfer} /> : null}
              <div className="space-y-1">
                <label className="text-muted-foreground block text-xs font-medium">반이동 날짜</label>
                <input
                  type="date"
                  required
                  value={transferDate}
                  min={today}
                  onChange={(e) => {
                    setTransferDate(e.target.value);
                    setTransferError(null);
                  }}
                  className="border-border bg-card text-foreground num w-full rounded-lg border px-2 py-1.5 text-sm"
                />
                <p className="text-muted-foreground text-xs">
                  {fromEnrollment && /^\d{4}-\d{2}-\d{2}$/.test(transferDate) ? (
                    <>
                      <span className="num">{transferDate}</span> 전날까지{" "}
                      <span className="font-medium">{fromEnrollment.className}</span>, 그날부터{" "}
                      <span className="font-medium">{selectedClass?.className ?? fixedClass?.className ?? "새 반"}</span>{" "}
                      {transferDate === today
                        ? " — 오늘 바로 적용됩니다."
                        : " — 예약으로 걸리고 적용 전까지 언제든 취소할 수 있습니다."}
                    </>
                  ) : (
                    "이 날짜가 새 수업의 첫날이고, 이전 수업은 그 전날까지입니다."
                  )}
                </p>
                {/* 🔴 끝날 날짜가 정해진 수강을 더 뒤로 옮기면 그 수강이 **이동일까지 늘어난다**(RPC가
                    옛 행의 종료일을 이동일로 덮는다) — 조용히 늘리지 말고 먼저 말한다. */}
                {!transfer.on && (isStudentMode || classFirst.chosenEligible) &&
                fromEnrollment?.endDate && fromEnrollment.endDate < transferDate ? (
                  <p className="text-chart-4 text-xs">
                    {fromEnrollment.className}은 <span className="num">{fromEnrollment.endDate}</span>에 끝날
                    예정입니다 — 이동일로 바꾸면 그날까지 늘어납니다.
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-muted-foreground block text-xs font-medium">
                시작일
              </label>
              <input
                name="startDate"
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="border-border bg-card text-foreground num w-full rounded-lg border px-2 py-1.5 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-muted-foreground block text-xs font-medium">
                종료일 (선택)
              </label>
              <input
                name="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="border-border bg-card text-foreground num w-full rounded-lg border px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          )}

          {orderedClassDays.length > 0 ? (
            <div className="space-y-1.5">
              <label className="text-foreground block text-sm font-medium">
                등원 요일
                <span className="text-muted-foreground ml-1 text-xs font-normal">
                  · 특정 요일만 등원하면 해제 (분리등원)
                </span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {orderedClassDays.map((d) => {
                  const on = attendingDays.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(d)}
                      aria-pressed={on}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {DAY_LABEL[d] ?? d}
                    </button>
                  );
                })}
              </div>
              <input type="hidden" name="attendanceDays" value={attendingDays.join(",")} />
              <p className="text-muted-foreground text-xs">
                {attendingDays.length === 0
                  ? "요일을 선택하지 않으면 전 요일 등원으로 저장됩니다."
                  : attendingDays.length >= orderedClassDays.length
                    ? "전 요일 등원"
                    : `${attendingDays.map((d) => DAY_LABEL[d] ?? d).join("·")}만 등원`}
              </p>
            </div>
          ) : null}

          {conflicts && conflicts.length > 0 ? (
            <div className="border-chart-4/40 bg-chart-4/5 rounded-lg border px-3 py-2 text-xs">
              <div className="text-chart-4 inline-flex items-center gap-1.5">
                <AlertTriangle className="size-3.5" />
                <span className="font-bold">시간 충돌</span>
              </div>
              <ul className="text-foreground mt-1 space-y-0.5">
                {conflicts.map((c, i) => (
                  <li key={i}>
                    {c.day}요일 {c.time} — {c.existingClass}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {overlapping.length > 0 ? (
            <div className="border-danger/40 bg-danger/5 rounded-lg border px-3 py-2 text-xs">
              <div className="text-danger inline-flex items-center gap-1.5">
                <AlertTriangle className="size-3.5" />
                <span className="font-bold">이미 배정된 반</span>
              </div>
              <p className="text-foreground mt-1">
                이 학생은 <span className="font-medium">{selectedClass?.className}</span>에 이미{" "}
                <span className="num">{periodLabel(overlapping[0])}</span> 배정되어 있습니다. 같은 반에
                기간이 겹치는 배정은 만들 수 없습니다.
              </p>
              <p className="text-muted-foreground mt-1">
                시작일을 겹치지 않게 바꾸거나, 학생 상세 &lsquo;수업&rsquo; 탭에서 기존 수강의 날짜·등원
                요일을 수정해 주세요.
              </p>
            </div>
          ) : null}

          {state?.error ? <p className="text-chart-4 text-sm">{state.error}</p> : null}
          {transferError ? <p className="text-chart-4 text-sm">{transferError}</p> : null}
          {bulk.on && bulk.error ? <p className="text-chart-4 text-sm">{bulk.error}</p> : null}
          {bulk.on ? <BulkAssignFailures failures={bulk.failures} doneCount={bulk.doneCount} /> : null}

          {/* 🔴 '반이동' 토글은 **좌하단**(원장 2026-09-18) — 켜면 이 창이 '새 배정'이 아니라
              '옛 반 종료 + 새 반 시작' 한 쌍을 만든다. 끄면 종전 그대로다. */}
          <footer className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <div className="flex items-center gap-1.5">
              {/* 반 이동 권한(classes full)이 없으면 토글을 **그리지 않는다** — 비활성으로 남기지 않는다(write-lock.ts 규칙 1). */}
              {allowTransfer ? (
                <button
                  type="button"
                  onClick={toggleTransfer}
                  disabled={sourceLocked}
                  aria-pressed={transferMode}
                  title="기존에 다니던 반을 이 반으로 옮깁니다. 이동 날짜 전날까지 이전 반, 그날부터 이 반입니다."
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    transferMode
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  반이동
                </button>
              ) : null}
              {!isStudentMode ? (
                <button
                  type="button"
                  onClick={toggleBulk}
                  disabled={sourceLocked}
                  aria-pressed={bulk.on}
                  title="여러 학생을 같은 시작일·등원 요일로 한 번에 배정합니다."
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    bulk.on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  단체 배정
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={() => onClose(false)}>
                취소
              </Button>
              {bulk.on ? (
                <Button type="button" onClick={bulk.run} disabled={bulk.pending || bulk.ids.length === 0}>
                  {bulk.pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                  {bulk.ids.length > 0 ? `${bulk.ids.length}명 배정` : "배정"}
                </Button>
              ) : transferMode ? (
                <Button
                  type="button"
                  onClick={runTransfer}
                  disabled={saving || loadingMovable || overlapping.length > 0 || !fromEnrollment ||
                    (!isStudentMode && !transfer.on && !classFirst.chosenEligible) ||
                    (transfer.on && (transfer.loading || transfer.uncertain || transfer.ids.length === 0 || transfer.invalidSelection))}
                >
                  {transferPending || transfer.pending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <UserPlus className="size-4" />
                  )}
                  {transfer.on ? `${transfer.ids.length}명 반 이동` : "배정"}
                </Button>
              ) : (
                <Submit disabled={overlapping.length > 0} />
              )}
            </div>
          </footer>
          </fieldset>
        </form>
      </div>
    </div>
  );
}
