"use client";

import {
  cloneElement,
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Pill } from "@/components/atoms/pill";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { formatSchoolGrade } from "@/features/exports/math-timetable/student-format";
import { splitNumberedItems } from "@/lib/text/split-numbered";
import { DAY_LABEL } from "@/features/timetable/lib/split-attendance";
import { isTimetableDragging, useTimetableDragging } from "./drag-flag";

/**
 * hover 카드 최대 높이 — 위치 클램프와 카드 max-height가 **같은 값**을 써야 화면 밖으로 안 나간다.
 * (옛 코드는 높이를 210px로 추정해 클램프만 했고, 진도·교재·상태가 다 붙은 카드는 300px를 넘어 잘렸다.)
 */
const HOVER_MAX_H = 320;

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

/**
 * 시간표 hover 정보 카드 — 커서 위치 기준 포털(고정·z최상위·pointer-events-none).
 * overflow 컨테이너(셀·DragScrollArea)에 안 잘리도록 document.body로 portal(ijw 패턴).
 * children(트리거)에 cloneElement로 hover 핸들러를 주입 — 추가 DOM 노드 없음.
 * (WindowLink는 onMouseEnter/Leave를 forward하도록 확장됨, div는 네이티브 지원.)
 * ⚠️ 트리거가 **이미 들고 있던** hover 핸들러는 덮지 않고 함께 부른다 — 드래그 학생 행이 같은 이벤트로
 *    'Delete=수강 종료' 대상(hoveredRef)을 추적하는데, 덮으면 그 추적이 조용히 죽는다(2026-09-04).
 */
export function HoverCard({
  card,
  width = 230,
  children,
}: {
  card: ReactNode;
  width?: number;
  children: ReactElement;
}) {
  const [pos, setPos] = useState<{
    x: number;
    y: number;
    el: HTMLElement;
    /** 카드를 연 순간의 트리거 자리 — 노드가 갈려도 "커서가 아직 그 줄 위인가"를 이걸로 판정한다. */
    rect: DOMRect;
  } | null>(null);
  // 카드가 **열려 있는 동안만** 드래그 신호를 구독한다 — 커서가 줄 위에 있는 채로 드래그가 시작되면
  // 이미 열린 카드가 그대로 떠 있어 끄는 내내 따라다닌다(show()만 막아선 그 경우가 안 막힌다).
  const dragging = useTimetableDragging(pos != null);

  function show(e: ReactMouseEvent) {
    // 끌고 있는 동안엔 카드를 안 띄운다(포인터가 줄 위를 스치며 포털이 열렸다 닫히면 그게 곧 렉이다).
    // 🔴 판정은 **렌더 밖 플래그**로 — prop/상태로 내리면 픽업 순간 350줄이 다시 그려진다(drag-flag.ts).
    if (isTimetableDragging()) return;
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
    // 동시에 하나 — 이전 카드들을 먼저 닫는다(닫히는 쪽이 자기 Set 항목을 지운다).
    for (const close of [...OPEN_CARDS]) close();
    // 🔴 트리거 노드를 **상태에 함께** 담는다(ref가 아니라) — 안전망이 "커서가 아직 이 줄 위인가"를 물을
    //    앵커다. `currentTarget`은 이벤트 처리가 끝나면 null이 되므로 지금 붙잡아야 한다.
    const el = e.currentTarget as HTMLElement;
    setPos({ x, y, el, rect: el.getBoundingClientRect() });
  }
  const hide = () => setPos(null);

  // 열려 있는 동안만 도는 안전망 — 트리거의 `mouseleave`가 안 오는 경우를 덮는다(위 주석).
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    OPEN_CARDS.add(close);

    const { el, rect } = pos;
    function onPointerMove(ev: PointerEvent) {
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
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("wheel", close, true);
    document.addEventListener("scroll", close, true);
    document.addEventListener("keydown", onEsc, true);
    document.addEventListener("visibilitychange", close);
    window.addEventListener("blur", close);
    return () => {
      OPEN_CARDS.delete(close);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("wheel", close, true);
      document.removeEventListener("scroll", close, true);
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
            <div
              className="border-line bg-card shadow-modal pointer-events-none fixed z-[9999] overflow-y-auto rounded-lg border p-3"
              style={{ left: pos.x, top: pos.y, width, maxHeight: HOVER_MAX_H }}
            >
              {card}
            </div>,
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
}: {
  className: string;
  subject: string;
  teacherName?: string | null;
  room?: string | null;
  schedule?: string | null;
  textbook?: string | null;
  counts: { active: number; hold: number; withdrawn: number };
  pendingHandover?: { teacherName: string | null; date: string | null } | null;
}) {
  const subjects = useSubjectMaps();
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-foreground text-sm font-bold">{className}</span>
        <Pill color={subjects.colorOf(subject)}>{subjects.labelOf(subject)}</Pill>
      </div>
      {pendingHandover ? (
        <div className="bg-blue-soft text-blue rounded px-1.5 py-1 text-xs font-bold">
          강사 인수인계 예정
          {pendingHandover.teacherName ? ` → ${pendingHandover.teacherName}` : ""}
          {pendingHandover.date ? ` (${pendingHandover.date})` : ""}
        </div>
      ) : null}
      <div className="space-y-1">
        <Row label="담임" value={teacherName ?? "—"} />
        <Row label="강의실" value={room ?? "—"} />
        {schedule ? <Row label="시간" value={schedule} mono /> : null}
        {textbook ? <Row label="교재" value={textbook} /> : null}
      </div>
      <div className="border-line flex flex-wrap items-center gap-x-2.5 border-t pt-1.5 num text-xs">
        <span className="text-primary">재원 {counts.active}</span>
        {counts.hold > 0 ? <span className="text-amber">대기 {counts.hold}</span> : null}
        {counts.withdrawn > 0 ? <span className="text-text-faint">퇴원 {counts.withdrawn}</span> : null}
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
}) {
  const partial =
    attendanceDays && attendanceDays.length > 0
      ? attendanceDays.map((d) => DAY_LABEL[d] ?? d).join("·") + "만 등원"
      : null;
  const hasDetail =
    isNew || isTransferredIn || partial || (status === "withdrawn" && endDate) || pendingClassName;
  return (
    <div className="space-y-2 break-keep text-xs">
      {/* 헤더 한 줄: 이름(좌) + 학년·학교(우상단). 별도 줄을 없애 세로 공간 절약. */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="text-foreground text-sm font-bold">{name}</span>
          {englishName ? <span className="text-text-dim">({englishName})</span> : null}
          {status === "withdrawn" ? (
            <Pill color="neutral">퇴원</Pill>
          ) : status === "hold" ? (
            <Pill color="amber">대기</Pill>
          ) : null}
        </div>
        {(() => {
          // 학교+학년을 ijw식 압축("달산초"+"초6"→"달산초6") — 셀 학생행과 동일 라벨.
          const sg = formatSchoolGrade(school, grade, { numberLast: true });
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
              <Pill color="primary">전입</Pill>
              {enrollmentDate ? (
                <span className="text-text-dim num text-xs">{enrollmentDate}</span>
              ) : null}
            </div>
          ) : isNew ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill color="danger">신입</Pill>
              {enrollmentDate ? (
                <span className="text-text-dim num text-xs">{enrollmentDate}</span>
              ) : null}
            </div>
          ) : null}
          {partial ? <Row label="등원" value={partial} /> : null}
          {pendingClassName ? (
            <Row
              label="이동 예정"
              value={`${pendingClassName}${pendingTransferDate ? ` (${pendingTransferDate})` : ""}`}
            />
          ) : null}
          {status === "withdrawn" && endDate ? <Row label="퇴원일" value={endDate} mono /> : null}
        </div>
      ) : null}
      {/* 교재·진도는 **같은 수업보고서 1건**에서 온다(queries.ts) — 그래서 한 블록에 묶어 날짜·강사
          헤더를 공유한다. 따로 두면 출처가 갈라진 것처럼 보이고, 실제로 예전엔 갈라져 있었다. */}
      {report && (report.progress || textbook) ? (
        <div className="border-line space-y-0.5 border-t pt-1.5">
          <div className="text-text-dim flex flex-wrap items-center gap-1.5">
            <span className="text-primary font-bold">진도</span>
            <span className="num">{report.date}</span>
            {report.teacherName ? <span>· {report.teacherName}</span> : null}
          </div>
          {textbook ? (
            <p>
              <span className="text-text-dim">교재 </span>
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
              {report.examInfo ? <span>시험 {report.examInfo}</span> : null}
              {report.homeworkScore ? <span>숙제 {report.homeworkScore}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
