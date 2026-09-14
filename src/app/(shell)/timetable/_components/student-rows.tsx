"use client";

import { useMemo, type ComponentProps, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useDraggable } from "@dnd-kit/core";
import { WindowLink } from "@/components/workspace/window-link";
import { formatSchoolGrade } from "@/features/exports/math-timetable/student-format";
import { dayChangeLabel } from "@/features/timetable/lib/split-attendance";
import { useTimetableEdit } from "./edit-context";
import { holdArmedRow, setArmedRow, useIsArmedRow, useTouchCapable } from "./drag-flag";
import { HoverCard, StudentInfoCard } from "./hover-cards";
import { useSearchTone } from "./search-context";
import { movingTone, RECENT_ROW_CLASS, useTimetableColorMode } from "./timetable-color";
import { shortMoveDate } from "@/features/timetable/lib/move-date";
import { moveWaitTitle, savedMoveView } from "@/features/timetable/lib/move-note";
import { SEAT_PIN_MARK_CLASS } from "@/features/timetable/lib/seat-pin-mark";

/**
 * 시간표 셀 학생 행(단일 셀·합반 공용) — class-cell.tsx에서 추출(200줄 규칙).
 * 합반 통합 명단용 추가: badge(반 인덱스 칩 "1"/"1,2") + blockingClassIds(드래그 data — 소속 반 이동 차단).
 *
 * 🔴 **여는 동작은 한 번 클릭**(원장 2026-09-09 *"그냥 클릭으로 바꿔줘. 더블클릭으로 작동하는걸 그냥 클릭으로.
 *    대신 드래그와 안겹쳐지게 조심해서"*) — 2026-09-04의 더블클릭 규약을 뒤집은 것이다.
 *    그때 더블클릭으로 갔던 이유(편집 모드가 없어져 모든 행이 상시 드래그 대상이라, 끌려다 만 손이 매번 창을
 *    연다)는 **여전히 유효하고**, 그래서 지금은 그 충돌을 **동작이 아니라 판정**으로 막는다:
 *    끌었으면(포인터가 `DRAG_MOVE_EPSILON`px 넘게 움직였으면) 뒤따르는 클릭을 보드 루트가 삼킨다
 *    ([`swallowClickAfterDrag`](./drag-flag.ts)). 제자리 클릭만 창을 연다.
 * ⚠️ 읽기 전용 행까지 **한 화면 안에서 같은 규약**이다(같은 표에서 어떤 줄은 한 번, 어떤 줄은 두 번이면 더 나쁘다).
 */

/** 셀 학생 1명 — 런타임엔 StudentLine 전체가 도착하므로 hover용 필드(영문명·분리등원)도 포함. */
export type StudentQuick = {
  name: string;
  grade: string | null;
  school: string | null;
  enrollmentId?: string;
  studentId?: string;
  /** active=재원, hold=대기, withdrawn=퇴원. (없으면 active로 간주 — 구버전 호출 호환) */
  status?: "active" | "hold" | "withdrawn";
  endDate?: string | null;
  isNew?: boolean;
  /** 등록 31~60일(신입 다음 단계). */
  isRecent?: boolean;
  isTransferredIn?: boolean;
  /**
   * **예약된 반 이동**(DB에 이미 저장된 것) — 나갈 예정 / 들어올 예정. 연보라 '이동 대기'로 표시하고
   * 툴팁이 기존 반 이름을 말한다(원장 2026-09-09). 판정·짝짓기는 서버(`pairScheduledMoves`) 단일 소스.
   * ⚠️ 저장 **전**의 큐(`useTimetableEdit().pending`)와 다른 축이다 — 색은 같고 문구가 다르다.
   */
  movingOut?: { on: string; className: string | null };
  movingIn?: { on: string; className: string | null };
  /**
   * 자리(랩실) **교시 고정** 표식 문구(0255a) — 있으면 이름이 파란 밑줄 이탤릭이 되고 이 문장이 툴팁이다.
   * 판정·서식은 [`seat-pin-mark.ts`](../../../../features/timetable/lib/seat-pin-mark.ts) 단일 소스.
   */
  seatPinNote?: string;
  /** 수강 시작일(YYYY-MM-DD) — hover에서 신입 시작일·전입일 표시용. 런타임엔 StudentLine 전체가 도착. */
  enrollmentDate?: string | null;
  englishName?: string | null;
  attendanceDays?: string[];
  latestTextbook?: { name: string; date: string | null } | null;
  latestReport?: {
    date: string;
    progress: string | null;
    examInfo: string | null;
    homeworkScore: string | null;
    teacherName: string | null;
  } | null;
};

/** 학생 행 메타 — 학교+학년을 ijw식으로 압축("경명중"+"중1" → "경명중1"). 좁은 셀에서 이름 공간 확보. */
export function metaLabel(school: string | null | undefined, grade: string | null | undefined): string {
  const sg = formatSchoolGrade(school, grade, { numberLast: true });
  return sg === "-" ? "" : sg;
}

/** 학생 행 배경 — 전입(초록)·신입(빨강)·그 외(진한 기본). ijw 시간표의 전학/신입 색 근사.
 * ⚠️ 전입을 신입보다 **먼저** 검사 — 반이동은 새 enrollment라 start_date가 최근이라 isNew도 true가 되지만,
 * 다른 반에서 옮겨온 기존 학생이므로 "신입(빨강)"이 아니라 "전입(초록)"으로 표시한다(ijw getEnrollmentStyle 순서 동일).
 * 재원생은 가독성을 위해 text-foreground(진함) — 대기/퇴원과 톤 위계를 둔다. */
export function studentRowTone(s: { isNew?: boolean; isRecent?: boolean; isTransferredIn?: boolean }): string {
  if (s.isTransferredIn) return "bg-primary-soft text-primary";
  if (s.isNew) return "bg-danger-soft text-danger";
  // 등록 31~60일 — 신입 다음 단계(원장 2026-09-07). 색은 timetable-color.ts 단일 소스.
  if (s.isRecent) return RECENT_ROW_CLASS;
  return "text-foreground";
}

export const ROW_CLASS =
  "flex items-baseline justify-between gap-1.5 px-2 py-[3px] leading-tight whitespace-nowrap";

/** 이름·메타 한 덩어리 — 이름이 먼저, 메타는 `/`로 붙어 좁으면 메타부터 잘린다(생략부호 없이 clip). */
const NAME_CLASS = "block overflow-hidden whitespace-nowrap text-clip";

/** 합반 인덱스 배지 — 이름 앞 작은 칩("1"/"1,2"). ijw classLabel(bg-gray-500) 대응. */
export function IndexBadge({ badge }: { badge?: string }) {
  if (!badge) return null;
  return (
    <span className="bg-ink/50 mr-0.5 inline-block shrink-0 rounded-[2px] px-0.5 align-middle num text-xs leading-tight font-bold text-white">
      {badge}
    </span>
  );
}

/** 이름 덩어리(배지 + 이름 + /학교학년). 이동 대기 행은 메타를 숨겨 화살표 자리를 만든다. */
function NameInner({
  name,
  meta,
  badge,
  pinNote,
}: {
  name: string;
  meta: string;
  badge?: string;
  /** 자리(랩실) 교시 고정 — 이름만 파란 밑줄 이탤릭 + 그 문장이 툴팁(원장 2026-09-10). */
  pinNote?: string;
}) {
  return (
    <>
      <IndexBadge badge={badge} />
      {/* 🔴 표식은 **이름 span에만** 얹는다 — 줄에는 이미 tone(신입 빨강·전입 초록·검색 표식)이 붙어 있어
          같은 축 유틸을 이어 붙이면 승자를 CSS 순서가 정한다([[#116]]). 자식이면 상속을 확실히 이긴다. */}
      {pinNote ? (
        <span className={SEAT_PIN_MARK_CLASS} title={pinNote}>
          {name}
        </span>
      ) : (
        name
      )}
      {meta ? <span className="opacity-90">/{meta}</span> : null}
    </>
  );
}

/**
 * 학생 이름 = 학생 상세 창(클릭). studentId가 없으면(구버전 데이터) 평범한 글자.
 * hover 카드는 호출부가 감싼다 — 드래그 행·읽기 행이 같은 카드를 쓴다.
 */
function StudentNameLink({
  studentId,
  name,
  title,
  className,
  children,
  ...rest
}: {
  studentId?: string;
  name: string;
  /**
   * 툴팁 문구 — 미지정이면 학생 이름. 예약 이동 줄이 "언제 어디로 가는지"를 여기 싣는다.
   * 🔴 **이름 자체를 갈아치우지 말 것** — `ariaLabel`이 이름에서 나오므로, 툴팁 문장을 이름 자리에
   *    넣으면 스크린리더가 "이동 대기 — … 학생 정보"를 읽는다(사람 이름이 사라진다).
   */
  title?: string;
  className: string;
  children: ReactNode;
} & Pick<ComponentProps<typeof WindowLink>, "onMouseEnter" | "onMouseLeave" | "onMouseMove">) {
  // 🔴 `...rest`를 반드시 흘려보낸다 — [`HoverCard`](./hover-cards.tsx)는 **트리거 엘리먼트에** hover 핸들러를
  //    주입한다(cloneElement). 이 래퍼가 그걸 삼키면 읽기 전용 줄(강사·뷰어·과거 주·대기·퇴원)의 정보 카드가
  //    통째로 죽는다 — 관리자가 이번 주에서 보면 드래그 줄이라 멀쩡해 눈에 안 띈다(적대 리뷰 2026-09-04).
  if (!studentId)
    return (
      <span className={className} title={title || undefined} {...rest}>
        {children}
      </span>
    );
  return (
    <WindowLink
      href={`/students/${studentId}`}
      title={title || name}
      ariaLabel={`${name} 학생 정보`}
      className={className}
      {...rest}
    >
      {children}
    </WindowLink>
  );
}

/**
 * 학생 한 줄(드래그 가능) — 편집 권한이 있는 사용자의 기본 행. 끌어서 반 이동/요일 이동,
 * **클릭**으로 학생 정보 창, **우클릭**으로 등원 요일 편집(2요일+ 셀). 이동 예정이면 취소선 + 대상 마커.
 * ⚠️ 드래그 리스너는 바깥 div에, 여는 동작은 안쪽 링크에 둔다(포인터 이벤트가 위로 버블링해 둘 다 산다).
 */
export function DraggableStudentRow(props: DraggableRowProps) {
  // 🔴 **마우스가 올라간 줄만** dnd 장치를 단다(drag-flag.ts `useIsArmedRow` 주석) — 348줄이 전부 훅을 들면
  //    집는 순간 그 전부가 다시 그려진다. 무장 줄과 평소 줄은 **같은 DOM**이라 마우스가 지나도 움찔하지 않는다.
  // ⚠️ 터치·펜엔 hover가 없어 그 기기에선 늘 무장한다(느린 것보다 못 옮기는 게 나쁘다).
  const rowKey = props.dayKey ? `${props.enrollmentId}:${props.dayKey}` : props.enrollmentId;
  const armed = useIsArmedRow(rowKey);
  // ⚠️ 터치·펜 기기는 hover가 없어 늘 무장한다 — 판정은 **마운트 뒤**에 켜진다(SSR과 같은 첫 렌더, [[#75]]).
  const touch = useTouchCapable();
  const inner =
    armed || touch ? <ArmedStudentRow {...props} /> : <RestingStudentRow {...props} rowKey={rowKey} />;
  // 🔴 hover 카드는 **스왑 바깥**에 둔다 — 무장 순간 줄이 다른 컴포넌트로 갈리면서 다시 마운트되는데,
  //    카드가 그 안에 있으면 첫 진입의 `mouseenter`가 옛 노드와 함께 사라져 **카드가 안 뜬다**
  //    (적대 리뷰 2026-09-04 제보 → 실브라우저에서 재현 확인). 카드는 여기서 한 번만 마운트된다.
  if (!props.student) return inner;
  return (
    <HoverCard width={240} card={<StudentCard student={props.student} />}>
      {inner}
    </HoverCard>
  );
}

type DraggableRowProps = {
  /** hover 카드 재료 — 읽기 행과 같은 카드를 띄운다(권한이 있다고 정보가 사라지면 안 된다). */
  student?: StudentQuick;
  enrollmentId: string;
  /** 학생 id — Delete=오늘 수강 종료 hover 추적 + 클릭 상세 링크. */
  studentId?: string;
  classId: string;
  className: string;
  name: string;
  meta: string;
  tone: string;
  /** 분리등원 요일 칸이면 요일 — 같은 학생이 여러 요일 칸에 떠도 draggable id를 유니크하게. enrollmentId는 data로 전달. */
  dayKey?: string;
  /** 이 학생의 등원 요일(분리등원, 비면 전 요일) — 도착 셀 '전입 예정' 요일 라벨용으로 drag data에 실어 보냄. */
  attendanceDays?: string[];
  /** 이 셀 slot.id + 덮는 요일 — 우클릭 시 같은 반 요일 편집 팝오버(2요일+ 셀에서만). */
  slotId?: string;
  coveringDays?: string[];
  /** 합반 인덱스 배지("1"/"1,2") — 통합 명단에서만. */
  badge?: string;
  /** 열린 수강(active+hold) 소속 반 전부 — resolveDropTarget의 소속 반 이동 차단용(drag data). */
  blockingClassIds?: string[];
};

/** 무장 전 — dnd 훅 없이 **같은 모습**으로 그리고, 마우스가 올라오면 무장시킨다. */
function RestingStudentRow({ rowKey, ...props }: DraggableRowProps & { rowKey: string }) {
  return <StudentRowView {...props} onArm={() => setArmedRow(rowKey)} />;
}

/** 무장 후 — dnd-kit draggable. 끌면 이동 큐에 쌓이고 반영은 '저장'이다. */
function ArmedStudentRow(props: DraggableRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: props.dayKey ? `student:${props.enrollmentId}:${props.dayKey}` : `student:${props.enrollmentId}`,
    // meta·tone·badge는 **드래그 고스트가 원본 줄 그대로** 보이게 하려고 싣는다(원장 2026-09-04
    // *"드래그해도 '황혜린/칠성초6'이 … 파일이동처럼 조금 연하게"*). 판정엔 안 쓴다.
    data: {
      classId: props.classId,
      name: props.name,
      meta: props.meta,
      tone: props.tone,
      badge: props.badge,
      fromClassName: props.className,
      enrollmentId: props.enrollmentId,
      attendanceDays: props.attendanceDays,
      blockingClassIds: props.blockingClassIds,
      // 🔴 집는 순간 **그 학생의 다른 과목 일정**을 받아 못 가는 반에 빗금을 치려면 학생 id가 필요하다
      //    (원장 2026-09-09 *"영어를 듣는 학생이면 영어 스케줄 때문에 이동이 불가능한 곳은 … 차단시켜"*).
      //    없으면(구버전 데이터) 조회를 건너뛰고 종전대로 동작한다(fail-open).
      studentId: props.studentId,
    },
  });
  return (
    <StudentRowView {...props} dnd={{ attributes, listeners, setNodeRef, isDragging }} />
  );
}

/**
 * 줄의 **모습** — 무장 여부와 무관하게 같은 DOM을 그린다(달라지면 마우스가 지날 때마다 줄이 움찔한다).
 * 끌 수 있는 상태면 `dnd`가 붙고, 아니면 `onArm`(마우스 진입)만 붙는다.
 */
function StudentRowView({
  student,
  enrollmentId,
  studentId,
  classId,
  className,
  name,
  meta,
  tone,
  attendanceDays,
  slotId,
  coveringDays,
  badge,
  dnd,
  onArm,
  onMouseEnter,
  onMouseLeave,
}: DraggableRowProps & {
  /** hover 카드가 `cloneElement`로 주입한 핸들러 — 줄의 제 핸들러와 **함께** 부른다. */
  onMouseEnter?: (e: ReactMouseEvent) => void;
  onMouseLeave?: (e: ReactMouseEvent) => void;
  dnd?: {
    attributes: ReturnType<typeof useDraggable>["attributes"];
    listeners: ReturnType<typeof useDraggable>["listeners"];
    setNodeRef: ReturnType<typeof useDraggable>["setNodeRef"];
    isDragging: boolean;
  };
  onArm?: () => void;
}) {
  const { pending, setHovered, openDayEdit } = useTimetableEdit();
  const colorMode = useTimetableColorMode();
  const target = pending.get(enrollmentId);
  const moving = !!target && !target.sameClass; // 반 이동=취소선+dim / 같은 반 요일 편집=배지만
  /**
   * 🔴 **예약 이동**(적용일이 오늘보다 뒤)은 연보라 '이동 대기'(원장 2026-09-09) — 오늘 옮기는 것과
   *    뜻이 다르다(그날까지는 이 반 학생이다). 즉시 이동은 종전 그대로 취소선+화살표.
   * ⚠️ 아직 **저장 전**이라 문구가 그렇게 말한다(예약으로 저장된 것과 색은 같고 말이 다르다 — move-note.ts).
   */
  const scheduledMove = moving && target!.scheduled;
  /**
   * **이미 저장된 예약 이동**(DB) — 저장 전 큐와 색은 같고 문구가 다르다(move-note.ts).
   * 🔴 끌어 옮기는 중이면 큐가 이긴다 — 사람이 방금 한 일이 화면의 주인공이다.
   */
  const saved = moving
    ? null
    : savedMoveView({
        status: student?.status,
        movingOut: student?.movingOut,
        movingIn: student?.movingIn,
        thisClassName: className,
      });
  const waiting = scheduledMove || !!saved;
  const moveTitle = scheduledMove
    ? moveWaitTitle({
        side: "out",
        fromClassName: className,
        toClassName: target!.toClassName,
        on: target!.applyOn,
        saved: false,
      })
    : (saved?.title ?? "");
  // 🔴 검색 표식은 드래그 줄에도 붙인다 — 검색은 이제 권한과 무관하게 켜져 있어서(옛 편집 모드가 끄던 것),
  //    안 붙이면 **관리자에게만** "누구를 찾았는지"가 사라진다(그 기능의 존재 이유가 그 표식이다).
  // ⚠️ 예약 tone은 **바탕**으로 넘긴다(덧붙이지 않는다) — 검색에 걸리면 검색 표식이 이겨야 하고,
  //    두 클래스를 이어 붙이면 같은 축 유틸이 겹쳐 승자를 CSS 순서가 정한다([[#116]]).
  const searchTone = useSearchTone(
    student ?? { name, grade: null, school: null },
    waiting ? movingTone(colorMode) : tone,
  );
  const canEditDays = (coveringDays?.length ?? 0) >= 2 && !!slotId;
  // 자리(랩실) 교시 고정 — 서버가 명단에 실어 보낸 문구 그대로(화면이 판정을 다시 하지 않는다).
  const pinNote = student?.seatPinNote;
  const isDragging = dnd?.isDragging ?? false;
  // 🔴 줄 **내용**은 메모이즈한다 — dnd-kit은 드래그 중 `over`가 바뀔 때마다 무장된 줄을 다시 그린다.
  //    같은 엘리먼트를 돌려주면 React가 그 서브트리를 통째로 건너뛴다.
  // 🔴 예약 이동은 **날짜까지** 키에 담는다 — 담지 않으면 툴바·팝업으로 날짜를 바꿔도 줄이 옛 날짜를 계속 보여 준다.
  const targetKey = target
    ? target.sameClass
      ? `day:${(target.toDays ?? []).join(",")}`
      : `move:${scheduledMove ? (target.applyOn ?? "") : ""}`
    : saved
      ? // 저장된 예약 — `→`는 나감, `←`는 들어옴(방향이 곧 뜻이다).
        `${saved.side === "out" ? "out" : "in"}:${saved.on}`
      : "";
  const body = useMemo(
    () => (
      <>
        <StudentNameLink
          studentId={studentId}
          name={name}
          title={moveTitle}
          className={`min-w-0 ${NAME_CLASS} ${moving ? "line-through" : ""}`}
        >
          <NameInner name={name} meta={targetKey ? "" : meta} badge={badge} pinNote={pinNote} />
        </StudentNameLink>
        {/* 반 이동=작은 "→", 같은 반 요일 편집=" →목만" 배지(학생이름 우선이라 반이름은 뺌).
            🔴 예약 이동은 **그 건의 날짜**를 함께 적는다 — 툴바 값 하나만 보면 건별 날짜가 안 보인다
               (원장 2026-09-09 날짜 팝업 지시). 좁은 칸이라 `9/15`까지만, 전문은 title에. */}
        {targetKey ? (
          targetKey.startsWith("day") ? (
            <span className="text-primary shrink-0 text-xs font-bold">
              →{dayChangeLabel(targetKey.slice(4) ? targetKey.slice(4).split(",") : [])}
            </span>
          ) : targetKey.startsWith("out:") || targetKey.startsWith("in:") ? (
            <span className="text-purple shrink-0 text-xs font-bold">
              {targetKey.startsWith("out:") ? "→" : "←"}
              {shortMoveDate(targetKey.slice(targetKey.indexOf(":") + 1))}
            </span>
          ) : targetKey.length > "move:".length ? (
            <span className="text-purple shrink-0 text-xs font-bold">
              →{shortMoveDate(targetKey.slice("move:".length))}
            </span>
          ) : (
            <span className="text-primary shrink-0 text-xs">→</span>
          )
        ) : null}
      </>
    ),
    // ⚠️ `moveTitle`도 넣는다 — 예약 이동 툴팁이 줄 안(링크)에 붙어 있어서, 날짜가 바뀌었는데 이 값이
    //    안 바뀌면 메모가 옛 문장을 붙들고 있는다(`targetKey`가 날짜를 담지만 문구는 반 이름도 쓴다).
    // ⚠️ `pinNote`도 넣는다 — 빠뜨리면 고정을 걸거나 푼 뒤 그 줄만 옛 모습을 붙들고 있는다.
    [studentId, name, meta, badge, moving, targetKey, moveTitle, pinNote],
  );
  const row = (
    <div
      ref={dnd?.setNodeRef}
      {...(dnd?.attributes ?? {})}
      {...(dnd?.listeners ?? {})}
      // 🔴 누르는 순간 무장을 잠근다 — 끌면서 지나는 다른 줄의 pointerover가 무장을 빼앗아 이 줄이 언마운트되면
      //    dnd-kit `active.data`가 비어 "출발 반을 알 수 없어"로 거절됐다(drag-flag.ts `holdArmedRow` 주석).
      onPointerDownCapture={() => holdArmedRow()}
      onPointerOver={() => {
        // 포인터가 올라오면 이 줄만 무장. 🔴 `pointerType`으로 거르지 않는다 — 터치 기기를 못 알아본
        //    경우(하이브리드 노트북)에도 최소한 이 경로는 살아 있어야 한다(적대 리뷰 2026-09-04).
        // ⚠️ 가 아니라  — enter/leave는 버블링이 없어 React 합성이 까다롭고,
        //    같은 값 재설정은 무동작이라 자식 사이를 오가며 여러 번 불려도 비용이 0이다.
        onArm?.();
      }}
      // ⚠️ hover 카드는 이 줄 **바깥**(DraggableStudentRow)에서 붙는다 — `cloneElement`가 주입한 핸들러가
      //    여기까지 내려오므로 함께 부른다(하나만 부르면 카드나 Delete 대상 중 하나가 죽는다).
      onMouseEnter={(e) => {
        onMouseEnter?.(e);
        setHovered({ enrollmentId, studentId: studentId ?? "", name, className });
      }}
      onMouseLeave={(e) => {
        onMouseLeave?.(e);
        setHovered(null);
      }}
      // 🔴 요일 편집은 **우클릭** — 클릭이 학생 창을 여는 자리라 클릭 계열이 남지 않았다([[#97]]와 같은 규약).
      onContextMenu={
        canEditDays
          ? (e) => {
              e.preventDefault();
              openDayEdit({
                enrollmentId,
                classId,
                slotId: slotId!,
                name,
                currentDays: attendanceDays ?? [],
                coveringDays: coveringDays!,
              });
            }
          : undefined
      }
      // 🔴 툴팁은 **예약 이동 같은 사실만** 싣는다(기존 반 이름 포함, 원장 명시).
      // 🔴 조작법 안내("끌어서 이동 · 클릭 = 학생 정보 …")는 뺐다(원장 2026-09-14) — 모든 학생 줄에 붙어
      //    hover 카드와 겹쳐 뜨기만 하고 정보 가치가 0이었다. 되살리지 말 것.
      title={moveTitle || undefined}
      className={`${ROW_CLASS} cursor-grab touch-none select-none active:cursor-grabbing ${searchTone} ${isDragging ? "opacity-40" : ""} ${moving && !scheduledMove ? "opacity-60" : ""}`}
    >
      {body}
    </div>
  );
  return row;
}

/** hover 카드 본문 — 드래그 행·읽기 행이 같은 카드를 쓴다(필드 나열을 두 벌로 두지 않는다). */
function StudentCard({ student }: { student: StudentQuick }) {
  return (
    <StudentInfoCard
      name={student.name}
      englishName={student.englishName}
      grade={student.grade}
      school={student.school}
      status={student.status}
      isNew={student.isNew}
      isTransferredIn={student.isTransferredIn}
      enrollmentDate={student.enrollmentDate}
      attendanceDays={student.attendanceDays}
      endDate={student.endDate}
      textbook={student.latestTextbook}
      report={student.latestReport}
    />
  );
}

/** 학생 한 줄(드래그 불가 — 편집 권한 없음·과거 주) — hover 시 학생 정보 카드, **클릭** 시 학생 상세 창. */
export function StudentRow({
  student,
  className: cardName = "",
  name,
  meta,
  tone,
  badge,
}: {
  student: StudentQuick;
  /** 이 줄이 서 있는 반 이름 — 예약 이동 툴팁의 '기존 반'/'가는 반' 한쪽을 채운다. */
  className?: string;
  name: string;
  meta: string;
  tone: string;
  /** 합반 인덱스 배지("1"/"1,2") — 통합 명단에서만. */
  badge?: string;
}) {
  const colorMode = useTimetableColorMode();
  /**
   * 읽기 전용 줄에도 **예약 이동은 보여야 한다** — 편집 권한이 없다고 사실이 사라지면 안 된다
   * (강사·과거 주 화면에서 "이 아이 곧 옮겨 가네"를 못 보면 그게 곧 정보 손실이다).
   */
  const saved = savedMoveView({
    status: student.status,
    movingOut: student.movingOut,
    movingIn: student.movingIn,
    thisClassName: cardName,
  });
  // 학생 검색에 걸린 줄이면 표식(안 걸리면 tone 그대로 = 지금까지와 완전히 동일). 남은 칸 안에서
  // **누구를 찾았는지**를 보여 준다 — 같은 반의 다른 학생은 그대로 보여야 "어느 반 몇 번째"가 읽힌다.
  const rowTone = useSearchTone(student, saved ? movingTone(colorMode) : tone);
  // `select-none` — 더블클릭이 여는 동작이라 글자가 선택돼 파랗게 남지 않게(드래그 줄과 같은 규약).
  const rowCls = `${NAME_CLASS} select-none px-2 py-[3px] leading-tight`;
  const inner = (
    <>
      <NameInner name={name} meta={saved ? "" : meta} badge={badge} pinNote={student.seatPinNote} />
      {/* 예약 이동 — `→`는 나감, `←`는 들어옴. 전문(기존 반 이름 포함)은 툴팁에. */}
      {saved ? (
        <span className="text-xs font-bold">
          {" "}
          {saved.side === "out" ? "→" : "←"}
          {shortMoveDate(saved.on)}
        </span>
      ) : null}
    </>
  );
  const trigger = student.studentId ? (
    <StudentNameLink
      studentId={student.studentId}
      name={name}
      title={saved?.title}
      className={`${rowCls} hover:bg-bg-soft ${rowTone}`}
    >
      {inner}
    </StudentNameLink>
  ) : (
    <div className={`${rowCls} ${rowTone}`} title={saved?.title || undefined}>
      {inner}
    </div>
  );
  return (
    <HoverCard width={240} card={<StudentCard student={student} />}>
      {trigger}
    </HoverCard>
  );
}
