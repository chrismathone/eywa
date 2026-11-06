"use client";
import { useTimetableDisplay } from "@/features/teacher-view/use-timetable-display";
import { useTimetableText } from "@/features/teacher-view/use-timetable-text";

import {
  cloneElement,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Pill } from "@/components/atoms/pill";
import { HOVER_CARD_MAX_H, HOVER_CARD_SHELL } from "@/components/hover-tip/card-style";
import { placeBeside, type HoverAside } from "@/features/timetable-cell-memo/placement";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { formatSchoolGrade } from "@/features/exports/math-timetable/student-format";
import { splitNumberedItems } from "@/lib/text/split-numbered";

import { isTimetableDragging, useTimetableDragging } from "./drag-flag";

/**
 * hover 카드 최대 높이 — 위치 클램프와 카드 max-height가 **같은 값**을 써야 화면 밖으로 안 나간다.
 * (옛 코드는 높이를 210px로 추정해 클램프만 했고, 진도·교재·상태가 다 붙은 카드는 300px를 넘어 잘렸다.)
 */
// 🔴 값·껍데기는 [card-style.ts](@/components/hover-tip/card-style) 한 곳 — 앱 전역 메모 툴팁
// ([HoverTipLayer](@/components/hover-tip/hover-tip-layer))가 **같은 모양**이어야 한다(원장 2026-09-15).
const HOVER_MAX_H = HOVER_CARD_MAX_H;

/**
 * **지금 열려 있는 카드들의 닫기 함수** — 새 카드가 열리면 나머지를 전부 닫는다.
 *
 * 🔴 왜 필요한가: 트리거의 `mouseleave`만 믿으면 카드가 화면에 **쌓인다**(원장 제보 2026-09-08
 *    *"마우스 올린게 다 남아있는데 … 호버링정보 꺼져야할거같은데 안꺼지네"* — 스샷에 6장이 겹쳐 있었다).
 *    학생 줄은 포인터가 올라오면 무장(`ArmedStudentRow`)으로 **컴포넌트가 갈리면서 DOM 노드가 교체**되는데,
 *    커서 아래에서 노드가 떨어져 나가면 브라우저는 그 노드에 `mouseleave`를 **보내지 않는다**. 그러면 그 줄의
 *    카드는 열린 채로 굳고, 지나간 줄마다 하나씩 남는다.
 * 🔑 그래서 방어를 **셋** 둔다: ① 새 카드가 열리면 나머지를 닫는다(동시에 하나) ② 열려 있는 동안 문서
 *    포인터를 지켜보다 트리거 밖으로 나가거나 트리거가 DOM에서 사라지면 닫는다 ③ 스크롤·클릭·창 이탈·Esc에도 닫는다.
 * ⚠️ 모듈 전역이라 창(iframe)마다 별개다 — 창 하나 안에서 카드는 최대 한 장.
 */
const OPEN_CARDS = new Set<() => void>();

/** 열려 있는 카드를 전부 닫는다 — 칸 메모 편집 상자가 열릴 때 그 자리의 hover 카드를 걷는다. */
export function closeOpenHoverCards(): void {
  for (const close of [...OPEN_CARDS]) close();
}

/** 카드 옆 2열(칸 메모)과 카드 사이 틈 · 칸에서 묶음으로 마우스를 옮기는 동안 기다리는 시간. */
const ASIDE_GAP = 8;
const ASIDE_GRACE_MS = 160;

type Grace = { current: number | null };
function graceClose(ref: Grace, close: () => void) {
  if (ref.current === null) ref.current = window.setTimeout(() => ((ref.current = null), close()), ASIDE_GRACE_MS);
}
function graceCancel(ref: Grace) {
  if (ref.current !== null) window.clearTimeout(ref.current);
  ref.current = null;
}

/**
 * 시간표 hover 정보 카드 — 커서 위치 기준 포털(고정·z최상위·pointer-events-none).
 * overflow 컨테이너(셀·DragScrollArea)에 안 잘리도록 document.body로 portal(ijw 패턴).
 * children(트리거)에 cloneElement로 hover 핸들러를 주입 — 추가 DOM 노드 없음.
 * (WindowLink는 onMouseEnter/Leave를 forward하도록 확장됨, div는 네이티브 지원.)
 * ⚠️ 트리거가 **이미 들고 있던** hover 핸들러는 덮지 않고 함께 부른다 — 드래그 학생 행이 같은 이벤트로
 *    'Delete=수강 종료' 대상(hoveredRef)을 추적하는데, 덮으면 그 추적이 조용히 죽는다(2026-09-04).
 * `aside` = 카드 **오른쪽 2열**(칸 메모, 원장 2026-10-22 *"정보 1열, 메모 2열"*) — 돌려준 것이 있으면 묶음을 **칸 옆**에 붙이고
 *    마우스를 칸에서 묶음으로 옮겨도 닫히지 않는다(메모를 눌러 고친다). 없으면(null) 종전 그대로 커서 옆 · 포인터 통과.
 */
export function HoverCard({
  card,
  width = 230,
  children,
  aside,
}: {
  card: ReactNode;
  width?: number;
  children: ReactElement;
  aside?: (trigger: HTMLElement) => HoverAside | null;
}) {
  const [pos, setPos] = useState<{
    x: number;
    y: number;
    el: HTMLElement;
    /** 카드를 연 순간의 트리거 자리 — 노드가 갈려도 "커서가 아직 그 줄 위인가"를 이걸로 판정한다. */
    rect: DOMRect;
    /** 2열(칸 메모) — 있을 때만 묶음이 칸 옆에 서고 포인터를 받는다. */
    extra?: HoverAside;
  } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const graceRef = useRef<number | null>(null);
  // 카드가 **열려 있는 동안만** 드래그 신호를 구독한다 — 커서가 줄 위에 있는 채로 드래그가 시작되면
  // 이미 열린 카드가 그대로 떠 있어 끄는 내내 따라다닌다(show()만 막아선 그 경우가 안 막힌다).
  const dragging = useTimetableDragging(pos != null);

  function show(e: ReactMouseEvent) {
    // 끌고 있는 동안엔 카드를 안 띄운다(포인터가 줄 위를 스치며 포털이 열렸다 닫히면 그게 곧 렉이다).
    // 🔴 판정은 **렌더 밖 플래그**로 — prop/상태로 내리면 픽업 순간 350줄이 다시 그려진다(drag-flag.ts).
    if (isTimetableDragging()) return;
    // 🔴 트리거 노드를 **상태에 함께** 담는다(ref가 아니라) — 안전망이 "커서가 아직 이 줄 위인가"를 물을
    //    앵커다. `currentTarget`은 이벤트 처리가 끝나면 null이 되므로 지금 붙잡아야 한다.
    const el = e.currentTarget as HTMLElement;
    // 2열 묶음에서 칸으로 돌아왔다 — 그대로 둔다(다시 열면 메모가 깜빡인다 · 닫힘 유예는 아래 안전망이 거둔다).
    if (pos?.extra && pos.el === el) return;
    const extra = aside?.(el) ?? null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = e.clientX + 16;
    if (x + width > vw - 8) x = e.clientX - width - 16;
    if (x < 8) x = 8;
    let y = e.clientY + 16;
    // ⚠️ 옛 코드는 카드 높이를 210/230px로 **고정 추정**해 클램프했는데, 진도(line-clamp-5)+교재+상태가
    // 다 붙은 학생 카드는 300px를 넘어 창(기본 680px) 아래로 잘렸다. 실측 대신 카드에 max-height를
    // 걸고(내부 스크롤) **같은 상수**로 클램프해 항상 화면 안에 들어오게 한다(적대 감사 UX).
    if (y + HOVER_MAX_H > vh - 8) y = Math.max(8, vh - 8 - HOVER_MAX_H);
    if (extra) {
      const at = placeBeside(
        extra.anchor,
        { width: width + ASIDE_GAP + extra.width, height: Math.max(extra.height, HOVER_MAX_H) },
        { width: vw, height: vh },
      );
      x = at.left;
      y = at.top;
    }
    // 동시에 하나 — 이전 카드들을 먼저 닫는다(닫히는 쪽이 자기 Set 항목을 지운다).
    for (const close of [...OPEN_CARDS]) close();
    setPos({ x, y, el, rect: el.getBoundingClientRect(), ...(extra ? { extra } : {}) });
  }
  // 2열이 있으면 여기서 닫지 않는다 — 칸에서 메모로 마우스를 옮기는 사이(틈 몇 px)에 꺼지지 않게.
  //    묶음 밖으로 나갔는지는 아래 안전망(pointermove)이 보고 잠깐 기다렸다 닫는다.
  const hide = () => {
    if (!pos?.extra) setPos(null);
  };

  // 열려 있는 동안만 도는 안전망 — 트리거의 `mouseleave`가 안 오는 경우를 덮는다(위 주석).
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    OPEN_CARDS.add(close);

    const { el, rect, extra } = pos;
    // 2열 묶음 안(메모를 읽거나 누르는 중)은 카드 밖이 아니다.
    const inWrap = (t: EventTarget | null) => !!extra && t instanceof Node && !!wrapRef.current?.contains(t);
    const closeOutside = (ev: Event) => {
      if (!inWrap(ev.target)) close();
    };
    const grace = graceRef;
    function onPointerMove(ev: PointerEvent) {
      if (extra) {
        const t = ev.target;
        if (inWrap(t) || (t instanceof Node && el.isConnected && el.contains(t))) graceCancel(grace);
        else graceClose(grace, close);
        return;
      }
      if (el.isConnected) {
        const target = ev.target;
        if (!(target instanceof Node) || !el.contains(target)) close();
        return;
      }
      // 트리거가 DOM에서 빠졌다(무장 스왑으로 노드가 교체됐다) — 이제 leave도 contains도 못 쓴다.
      // 🔴 그렇다고 바로 닫으면 **줄에 올리자마자 카드가 꺼진다**(스왑은 마우스를 올리는 그 순간 일어난다).
      //    커서가 아직 그 줄 자리 안이면 유지하고, 자리를 벗어났을 때만 닫는다. 새 노드가 곧
      //    자기 mouseenter로 앵커를 다시 잡는다. (스크롤은 따로 닫으므로 자리가 밀려 어긋날 일이 없다.)
      const inside =
        ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom;
      if (!inside) close();
    }
    function onEsc(ev: KeyboardEvent) {
      if (ev.key === "Escape") close();
    }

    // ⚠️ capture로 듣는다 — 중간에서 stopPropagation 하는 표(드래그 팬 영역)가 있어도 도달해야 한다.
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("wheel", closeOutside, true);
    document.addEventListener("scroll", closeOutside, true);
    document.addEventListener("keydown", onEsc, true);
    document.addEventListener("visibilitychange", close);
    window.addEventListener("blur", close);
    return () => {
      OPEN_CARDS.delete(close);
      graceCancel(grace);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("wheel", closeOutside, true);
      document.removeEventListener("scroll", closeOutside, true);
      document.removeEventListener("keydown", onEsc, true);
      document.removeEventListener("visibilitychange", close);
      window.removeEventListener("blur", close);
    };
  }, [pos]);

  const child = children as unknown as ReactElement<{
    onMouseEnter?: (e: ReactMouseEvent) => void;
    onMouseLeave?: (e: ReactMouseEvent) => void;
  }>;
  const childEnter = child.props.onMouseEnter;
  const childLeave = child.props.onMouseLeave;
  const trigger = cloneElement(child, {
    onMouseEnter: (e: ReactMouseEvent) => {
      childEnter?.(e);
      show(e);
    },
    onMouseLeave: (e: ReactMouseEvent) => {
      childLeave?.(e);
      hide();
    },
  });

  return (
    <>
      {trigger}
      {pos && !dragging
        ? createPortal(
            pos.extra ? (
              <div
                ref={wrapRef}
                className="fixed z-[9999] flex items-start"
                style={{ left: pos.x, top: pos.y, gap: ASIDE_GAP }}
                onPointerEnter={() => graceCancel(graceRef)}
                onPointerLeave={() => graceClose(graceRef, () => setPos(null))}
              >
                <div className={`${HOVER_CARD_SHELL} shrink-0 overflow-y-auto`} style={{ width, maxHeight: HOVER_MAX_H }}>
                  {card}
                </div>
                {pos.extra.node}
              </div>
            ) : (
              <div
                className={`${HOVER_CARD_SHELL} pointer-events-none fixed z-[9999] overflow-y-auto`}
                style={{ left: pos.x, top: pos.y, width, maxHeight: HOVER_MAX_H }}
              >
                {card}
              </div>
            ),
            document.body,
          )
        : null}
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-text-dim shrink-0">{label}</span>
      <span className={`text-foreground text-right ${mono ? "num" : ""}`}>{value}</span>
    </div>
  );
}

/** 수업 hover — 수업명·과목·담임·강의실·시간·인원(+교재, Phase 3). */
export function ClassInfoCard({
  className,
  subject,
  teacherName,
  room,
  schedule,
  textbook,
  counts,
  pendingHandover,
  note,
}: {
  className: string;
  subject: string;
  teacherName?: string | null;
  room?: string | null;
  schedule?: string | null;
  textbook?: string | null;
  counts: { active: number; hold: number; withdrawn: number };
  pendingHandover?: { teacherName: string | null; date: string | null } | null;
  note?: string;
}) {
  const display = useTimetableDisplay();
  const tt = useTimetableText();
  const subjects = useSubjectMaps();
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-foreground text-sm font-bold">{display.className(className)}</span>
        <Pill color={subjects.colorOf(subject)}>{tt(subjects.labelOf(subject))}</Pill>
      </div>
      {pendingHandover ? (
        <div className="bg-blue-soft text-blue rounded px-1.5 py-1 text-xs font-bold">
          {tt("강사 인수인계 예정")} {pendingHandover.teacherName ? ` → ${display.teacher(pendingHandover.teacherName)}` : ""}
          {pendingHandover.date ? ` (${pendingHandover.date})` : ""}
        </div>
      ) : null}
      <div className="space-y-1">
        <Row label={tt("담임")} value={display.teacher(teacherName) ?? "—"} />
        <Row label={tt("강의실")} value={room ? display.room(room) : "—"} />
        {schedule ? <Row label={tt("시간")} value={display.note(schedule)} mono /> : null}
        {textbook ? <Row label={tt("교재")} value={textbook} /> : null}
        {note ? <p className="whitespace-pre-wrap break-words">{note}</p> : null}
      </div>
      <div className="border-line flex flex-wrap items-center gap-x-2.5 border-t pt-1.5 num text-xs">
        <span className="text-primary">{tt("재원")} {counts.active}</span>
        {counts.hold > 0 ? <span className="text-amber">{tt("대기")} {counts.hold}</span> : null}
        {counts.withdrawn > 0 ? <span className="text-text-faint">{tt("퇴원")} {counts.withdrawn}</span> : null}
      </div>
    </div>
  );
}

/** 학생 hover — 이름(영문)·상태·학년/학교·신입/전입·분리등원·퇴원일(+반이동 예정, Phase 2). */
export function StudentInfoCard({
  name,
  englishName,
  grade,
  school,
  status,
  isNew,
  isTransferredIn,
  enrollmentDate,
  attendanceDays,
  endDate,
  textbook,
  report,
  pendingClassName,
  pendingTransferDate,
  pinNote,
  labSeparate,
}: {
  name: string;
  englishName?: string | null;
  grade?: string | null;
  school?: string | null;
  status?: "active" | "hold" | "withdrawn";
  isNew?: boolean;
  isTransferredIn?: boolean;
  /** 수강 시작일(YYYY-MM-DD) — 신입=신입 시작일, 전입=전입일로 라벨 옆에 표시(라벨 없으면 미표시). */
  enrollmentDate?: string | null;
  attendanceDays?: string[];
  endDate?: string | null;
  textbook?: { name: string; date: string | null } | null;
  report?: {
    date: string;
    progress: string | null;
    examInfo: string | null;
    homeworkScore: string | null;
    teacherName: string | null;
  } | null;
  pendingClassName?: string | null;
  pendingTransferDate?: string | null;
  /**
   * 자리(랩실) **교시 고정** 문구(0255a) — 학생 줄의 파란 밑줄 표식이 뜻하는 바를 카드가 글자로 말한다.
   * 🔴 줄의 표식에 툴팁을 따로 달지 말 것 — 줄은 이미 이 카드를 띄우므로 카드와 툴팁이 겹친다(원장 2026-09-15).
   */
  pinNote?: string | null;
  /** LAB '따로 수업(*LAB)' 배정(0271b) — 줄의 파란 이탤릭 이름이 뜻하는 바를 카드가 글자로 말한다(툴팁 따로 없음). */
  labSeparate?: boolean;
}) {
  const display = useTimetableDisplay();
  const tt = useTimetableText();
  const partial =
    attendanceDays && attendanceDays.length > 0
      ? attendanceDays.map((d) => display.dow(d)).join("·") + tt("만 등원")
      : null;
  const hasDetail =
    isNew ||
    isTransferredIn ||
    partial ||
    (status === "withdrawn" && endDate) ||
    pendingClassName ||
    pinNote ||
    labSeparate;
  return (
    <div className="space-y-2 break-keep text-xs">
      {/* 헤더 한 줄: 이름(좌) + 학년·학교(우). 별도 줄을 없애 세로 공간 절약.
          🔴 items-baseline — 이름(14px)과 학교·학년(12px)의 글자 바닥선을 맞춘다. 예전 items-start는 작은 글씨를
          줄 위쪽 끝에 붙여 학교·학년이 이름보다 위로 떠 보였다(원장 2026-11-06 *"학교학년이 이름보다 위쪽에 있어서"*).
          이름 묶음이 줄바꿈돼도 첫 줄(이름) 바닥선에 맞는다. */}
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="text-foreground text-sm font-bold">{display.student(name, englishName)}</span>
          {display.lang !== "en" && englishName ? <span className="text-text-dim">({englishName})</span> : null}
          {status === "withdrawn" ? (
            <Pill color="neutral">{tt("퇴원")}</Pill>
          ) : status === "hold" ? (
            <Pill color="amber">{tt("대기")}</Pill>
          ) : null}
        </div>
        {(() => {
          // 학교+학년을 ijw식 압축("달산초"+"초6"→"달산초6") — 셀 학생행과 동일 라벨.
          const sg = display.lang === "en" ? display.school(school, grade) : formatSchoolGrade(school, grade, { numberLast: true });
          return sg && sg !== "-" ? (
            <span className="text-text-dim shrink-0 text-right text-xs leading-tight">{sg}</span>
          ) : null;
        })()}
      </div>
      {hasDetail ? (
        <div className="border-line space-y-1 border-t pt-1.5">
          {/* 신입·전입 상호배타 — 반이동 학생은 전입만(전입 우선). 데이터 계층에서 이미 배타지만 표시도 방어적으로.
              날짜(enrollmentDate=수강 시작일)를 라벨 옆에 표기: 신입=신입 시작일, 전입=전입일. 라벨과 같은 블록이라
              신입/전입 창(30일)이 지나 라벨이 사라지면 날짜도 함께 사라진다. */}
          {isTransferredIn ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill color="primary">{tt("반이동")}</Pill>
              {enrollmentDate ? (
                <span className="text-text-dim num text-xs">{enrollmentDate}</span>
              ) : null}
            </div>
          ) : isNew ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill color="danger">{tt("신입")}</Pill>
              {enrollmentDate ? (
                <span className="text-text-dim num text-xs">{enrollmentDate}</span>
              ) : null}
            </div>
          ) : null}
          {partial ? <Row label={tt("등원")} value={partial} /> : null}
          {pinNote ? <Row label={tt("자리")} value={display.note(pinNote)} /> : null}
          {labSeparate ? <Row label="LAB" value={tt("따로 수업(*LAB) 배정")} /> : null}
          {pendingClassName ? (
            <Row
              label={tt("이동 예정")}
              value={`${pendingClassName}${pendingTransferDate ? ` (${pendingTransferDate})` : ""}`}
            />
          ) : null}
          {status === "withdrawn" && endDate ? <Row label={tt("퇴원일")} value={endDate} mono /> : null}
        </div>
      ) : null}
      {/* 교재·진도는 **같은 수업보고서 1건**에서 온다(queries.ts) — 그래서 한 블록에 묶어 날짜·강사
          헤더를 공유한다. 따로 두면 출처가 갈라진 것처럼 보이고, 실제로 예전엔 갈라져 있었다. */}
      {report && (report.progress || textbook) ? (
        <div className="border-line space-y-0.5 border-t pt-1.5">
          <div className="text-text-dim flex flex-wrap items-center gap-1.5">
            <span className="text-primary font-bold">{tt("진도")}</span>
            <span className="num">{report.date}</span>
            {report.teacherName ? <span>· {display.teacher(report.teacherName)}</span> : null}
          </div>
          {textbook ? (
            <p>
              <span className="text-text-dim">{tt("교재")}</span>
              <span className="text-foreground">{textbook.name}</span>
            </p>
          ) : null}
          {/* 진도 스마트 줄바꿈 — "1.극한 2.연속" 인라인 번호 run-on을 항목별 줄로(오탐 시 원문 1줄).
              whitespace-pre-line이라 원문 \n도 살고, line-clamp가 물리 줄 기준으로 과대 성장 방지. */}
          {report.progress ? (
            <p className="text-foreground line-clamp-5 whitespace-pre-line">
              {splitNumberedItems(report.progress).join("\n")}
            </p>
          ) : null}
          {report.examInfo || report.homeworkScore ? (
            <div className="text-text-dim flex flex-wrap gap-x-2.5 num text-xs">
              {report.examInfo ? <span>{tt("시험")} {report.examInfo}</span> : null}
              {report.homeworkScore ? <span>{tt("숙제")} {report.homeworkScore}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
