"use client";

import { useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import { useDraggable } from "@dnd-kit/core";
import { WindowLink } from "@/components/workspace/window-link";
import { Pill } from "@/components/atoms/pill";
import { cn } from "@/lib/utils";
import {
  PAGER_STEP_BASE,
  PAGER_STEP_ENABLED,
  PAGER_STEP_DISABLED,
  PAGER_LABEL,
} from "@/components/pagination";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import type { ConsultationListRow } from "@/features/enrollment/server/queries";
import { MakeeduOriginTag } from "@/components/makeedu-origin-tag";
import { EditingBadge } from "@/features/presence/editing-badge";
import { RelativeTime } from "@/components/relative-time";
import { OUTCOME_PILL } from "./outcome-meta";
import {
  ASSIGNED_LABEL,
  QR_INTAKE_LABEL,
  cardMarkOf,
  type BoardStageKey,
  type CardMark,
} from "@/features/enrollment/board-stages";
import { EyIcon } from "@/components/icons/eywa-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { MergeDialog } from "../[id]/merge-dialog";

/**
 * 한 페이지에 그릴 카드 수 — **10장**(원장 2026-09-01 *"10개 카드 크기에 딱 여백 알맞게"*).
 *
 * 8 → 10 → 8 → **10**. 여백을 줄이기 전엔 10장이 창을 넘겨 하단 스크롤이 생겨서 8로 내렸는데,
 * 카드(px-3.5 py-2.5)·줄간격(6px)·칸 머리(py-2.5)를 함께 줄이고 나니 10장이 그대로 들어간다.
 * 🔑 기준은 페이지 수가 아니라 **가장 긴 칸이 창 안에 들어가는가**다 — 이 값을 더 올릴 땐 최대 창에서
 *    스크롤이 안 생기는지 눈으로 먼저 확인할 것.
 */
const PAGE_SIZE = 10;

/**
 * 등록상담 칸반 컬럼 카드 목록 — 한 컬럼에 100+ 카드가 쏟아져 페이지가 끝없이 길어지는 걸 막는다.
 * 옛 "+N개 더 보기"(전체 펼침)는 200장이 통째로 펼쳐져 스크롤이 폭발했다 → **컬럼 내 페이지네이션**으로
 * 전환: 페이지당 PAGE_SIZE개만 렌더 + ◀▶로 이동 → 컬럼 높이가 항상 ≤ PAGE_SIZE장으로 고정된다.
 * (데이터는 이미 클라에 있으므로 추가 fetch 없이 슬라이스만.)
 */
export function ColumnCards({
  cards,
  nowMs,
  stage,
  draggable,
  focusId,
  onUserPaged,
}: {
  cards: ConsultationListRow[];
  /** 서버 렌더 시각 — 상대시간 하이드레이션 불일치 방지(RelativeTime 주석 참조). */
  nowMs: number;
  /** 이 목록이 서 있는 칸 — 카드 표식이 칸마다 다르다(board-stages.cardMarkOf). */
  stage: BoardStageKey;
  /** 등록상담 쓰기 권한. 없으면 집히지도 않는다(서버 액션이 다시 검증한다 — 화면은 게이트가 아니다). */
  draggable: boolean;
  /**
   * 🔴 방금 이 칸으로 끌어다 놓은 상담. **그 카드가 있는 페이지를 강제로 편다.**
   * 카드는 상담일 역순으로 꽂히므로, 페이지가 여러 장인 칸에 오래된 상담을 옮기면 2·3페이지에 들어가
   * **원래 칸에서는 사라지고 새 칸에는 안 보인다**("옮겼는데 없어졌다"). 목록은 클라에 다 있어서
   * 페이지만 맞추면 된다.
   */
  focusId?: string | null;
  /** 사용자가 페이저를 누르면 위 강제 펼침을 놓아 준다(사람 조작이 이긴다). */
  onUserPaged?: () => void;
}) {
  const [page, setPage] = useState(0);
  const subjectMaps = useSubjectMaps(); // 팝오버 상담 행의 과목 라벨(클라 단일소스)
  const totalPages = Math.max(1, Math.ceil(cards.length / PAGE_SIZE));
  // 방금 옮겨 온 카드가 이 칸에 있으면 그 페이지가 이긴다(렌더 중 파생 — setState 아님).
  const focusIndex = focusId ? cards.findIndex((c) => c.id === focusId) : -1;
  const wanted = focusIndex >= 0 ? Math.floor(focusIndex / PAGE_SIZE) : page;
  // 필터로 카드 수가 줄어 현재 page가 범위를 벗어나면 마지막 페이지로 보정(렌더 중 파생값 — setState 아님).
  const safePage = Math.min(wanted, totalPages - 1);
  const visible = cards.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const goPage = (n: number) => {
    setPage(n);
    onUserPaged?.();
  };

  return (
    <div className="flex flex-1 flex-col">
      {/* ⚠️ 위치: 목록은 **최소 56vh를 깔고 남는 높이를 채운다**(min-h + flex-1).
          · min-h → 페이지마다 카드 수·내용 높이가 달라도 컬럼이 안 줄어 페이저가 같은 자리에 머문다
            ("페이지 이동 때마다 위치가 틀어짐" 해소). 한 페이지가 더 길면 내부 스크롤.
          · flex-1 → 🔴 **고정 높이(h-56vh)만 두면 페이저가 컬럼 한가운데에 뜬다.** 칸반은 grid라
            컬럼이 **가장 긴 컬럼 높이로 늘어나는데**(페이지네이션이 없는 컬럼이 대개 더 길다) 목록만
            56vh에서 멈춰서 그 아래가 통째로 빈다(원장 2026-08-05 스크린샷). 남는 공간을 목록이 먹고
            페이저는 컬럼 바닥에 붙는다. */}
      {/* ⚠️ 위·아래 여백이 **같다**(p-2.5, 원장 2026-09-01 *"상단여백과 하단 여백 같게"*) — 위만 넓으면
          카드가 아래로 쏠려 보인다. `min-h`는 뺐다: 카드 열 장이 이미 칸을 채워서, 바닥값이 남으면
          짧은 칸에 빈 띠만 만든다. */}
      <ul className={`space-y-1.5 p-2.5 ${totalPages > 1 ? "flex-1 overflow-y-auto" : ""}`}>
        {visible.map((c) => (
          <ConsultationCard
            key={c.id}
            card={c}
            nowMs={nowMs}
            stage={stage}
            draggable={draggable}
            subjectLabelOf={subjectMaps.labelOf}
          />
        ))}
      </ul>

      {totalPages > 1 ? (
        // 공용 페이저 스타일(`<Pagination>`과 동일 클래스 상수) — 앱 전역 페이지네이션 룩 통일.
        // 글씨만 카드에 맞춰 한 단계 키운다. 🔴 상수를 그대로 이어 붙이면 `text-xs`와 충돌해 승자가
        // CSS 순서로 정해지므로([[#116]]) 반드시 `cn`(tailwind-merge)을 통과시킨다.
        <nav
          className="border-line flex items-center justify-between gap-2 border-t px-3 py-1.5"
          aria-label="페이지 이동"
        >
          <button
            type="button"
            onClick={() => goPage(safePage - 1)}
            disabled={safePage === 0}
            className={cn(
              PAGER_STEP_BASE,
              "text-sm",
              safePage === 0 ? PAGER_STEP_DISABLED : PAGER_STEP_ENABLED,
            )}
          >
            <EyIcon name="chevronLeft" size={14} />
            이전
          </button>
          <span className={cn(PAGER_LABEL, "text-sm")}>
            {safePage + 1} / {totalPages} · {cards.length}건
          </span>
          <button
            type="button"
            onClick={() => goPage(safePage + 1)}
            disabled={safePage >= totalPages - 1}
            className={cn(
              PAGER_STEP_BASE,
              "text-sm",
              safePage >= totalPages - 1 ? PAGER_STEP_DISABLED : PAGER_STEP_ENABLED,
            )}
          >
            다음
            <EyIcon name="chevronRight" size={14} />
          </button>
        </nav>
      ) : null}
    </div>
  );
}

/**
 * 카드 한 장.
 *
 * 🔑 **글씨 1.5배 + 두 줄을 감춘다**(원장 2026-09-01). 이름 줄은 `백시후 (수창초3)` 한 줄로 합치고
 *    (학교·학년 압축은 [`schoolGradeLabel`](@/lib/format/school-grade) 단일 소스 — 문자열을 직접
 *    조립하면 "경명여중 중1"처럼 앱 전역 표기와 갈린다), 요약·상담사는 **마우스 오버**로 내린다.
 * ⚠️ `WindowLink`의 `title`은 **창 제목**이지 DOM 툴팁이 아니다 — 오버 툴팁은 바깥 래퍼의 title이다.
 * ⚠️ 툴팁은 손가락 기기에선 없는 것과 같다(디자인 규칙). 요약·상담사는 카드를 열면 바로 나오므로
 *    폰에서도 한 번의 탭으로 닿는다 — 카드에 다시 그리지 말 것(밀도가 지시의 핵심이다).
 */
function ConsultationCard({
  card: c,
  nowMs,
  stage,
  draggable,
  subjectLabelOf,
}: {
  card: ConsultationListRow;
  nowMs: number;
  stage: BoardStageKey;
  draggable: boolean;
  subjectLabelOf: (key: string) => string;
}) {
  // 🔑 '반 배정 완료' 카드도 **집히기는 한다** — 옮겨지지는 않고(부모가 드롭을 거절) 왜 못 옮기는지를
  //    말해 준다. `disabled`로 막으면 끌어도 아무 일이 안 일어나 "고장"으로 읽힌다.
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: `consult:${c.id}`,
    data: { cardId: c.id },
    disabled: !draggable,
  });
  // 드래그가 끝난 자리에서 나는 click은 창을 연다 — 눌러 내린 지점과 5px 이상 떨어졌으면 이동을 막는다
  // (dnd-kit이 click까지 삼켜 주지는 않는다). 상태가 아니라 ref라 리렌더가 없다.
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const router = useRouter();
  // '상담 N건' 팝오버에서 바로 병합(원장 2026-09-01 *"여기서 바로 병합할 수 있게 우상단 병합버튼"*).
  // 중복을 발견하는 자리가 곧 정리하는 자리 — 상세로 들어갔다 나올 이유가 없다.
  const [mergeOpen, setMergeOpen] = useState(false);

  const mark = cardMarkOf(c, stage);
  const gradeLabel = schoolGradeLabel(c.prospectSchool, c.prospectGrade);
  // 마우스 오버 = 감춘 줄들(상담사 · 배정 수업 수 · 학부모 요청 원문). 빈 값이면 title 자체를 안 단다.
  // ⚠️ '수업 N개'는 옛 카드의 둘째 줄에 있던 사실이다 — 줄을 없애면서 여기로 옮겼다(그냥 지우면
  //    "반 배정 완료"만 남아 몇 개인지 알 길이 사라진다).
  const hover =
    [
      // 🔑 이름 줄은 한 줄로 잘릴 수 있다 — 전문을 여기 맨 앞에 둬야 잘린 글자가 사라지지 않는다.
      gradeLabel ? `${c.prospectName} (${gradeLabel})` : c.prospectName,
      c.consultantName ? `상담사 ${c.consultantName}` : null,
      c.assignedClassCount >= 1 ? `수업 ${c.assignedClassCount}개` : null,
      c.parentRequest?.trim() || null,
    ]
      .filter(Boolean)
      .join("\n\n") || undefined;

  return (
    <li>
      <div
        ref={setNodeRef}
        {...listeners}
        // 🔴 dnd-kit의 `attributes`(role="button"·tabIndex·aria-roledescription)는 **안 붙인다** —
        //    이 상자 안에 진짜 링크가 있어 중첩 인터랙티브가 된다(스크린리더가 카드를 버튼으로 읽고
        //    링크를 잃는다). 키보드로 상태를 바꾸는 길은 드래그가 아니라 상세 화면의 '상태 변경'이다
        //    (그래서 드롭다운을 남겨 뒀다 — 드래그는 마우스의 빠른 길일 뿐이다).
        title={hover}
        onPointerDownCapture={(e: PointerEvent<HTMLDivElement>) => {
          downAt.current = { x: e.clientX, y: e.clientY };
        }}
        onClickCapture={(e: MouseEvent<HTMLDivElement>) => {
          // ⚠️ `detail === 0` = 키보드(Enter/Space)로 링크를 연 것 — 좌표가 (0,0)이라 거리 규칙에
          //    걸리면 **키보드로는 카드를 영영 못 연다**. 포인터가 실제로 누른 클릭만 검사한다.
          if (e.detail === 0) return;
          const d = downAt.current;
          if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        className={cn(draggable && "cursor-grab active:cursor-grabbing", isDragging && "opacity-40")}
      >
        <WindowLink
          href={`/enrollment/${c.id}`}
          title={c.prospectName}
          // 🔴 카드마다 실선 테두리(원장 2026-09-01 *"각 카드별 테두리"*) — 연한 면(bg-bg-soft/60)만으론
          //    카드끼리 경계가 녹아 한 덩어리로 읽혔다. 칸 테두리(칸 색)보다 한 단계 중립적인 선이라
          //    "칸 안의 카드"라는 위계가 유지된다(팔레트 v4: 면은 화이트, 구분은 테두리).
          className="border-line bg-bg-soft/60 hover:bg-bg-soft hover:border-line-strong block rounded-xl border px-3.5 py-2.5 transition"
        >
          {/* 🔴 **카드 높이를 통일한다**(원장 2026-09-01 *"카드 크기 통일시켜줘"*): 이름 줄을 **한 줄 고정
              높이**로 못 박는다. 그전엔 배지(QR·반 배정·상담 N건·수정중)와 긴 학교명이 줄을 접어서
              같은 칸 안에서도 카드가 들쭉날쭉했다. 접히지 않게 이름만 잘리고(`truncate`), 잘린 전문은
              마우스 오버(title 첫 줄)에 그대로 있다.
              ⚠️ `flex-wrap`을 다시 넣지 말 것 — 한 장만 두 줄이 되면 그 카드만 키가 커진다. */}
          <div className="flex h-7 items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center">
              {/* 이름 + (학교학년) 한 줄 — 옛 두 줄("백시후" / "초3 수창초")을 합친 것. */}
              <p className="text-foreground flex min-w-0 items-center gap-1.5 text-xl leading-none font-bold">
                <span className="min-w-0 truncate">
                  {c.prospectName}
                  {gradeLabel ? (
                    <span className="text-text-dim ml-1 text-base font-semibold">({gradeLabel})</span>
                  ) : null}
                </span>
                {c.personConsultCount > 1 ? (
                  // 배지 클릭 = 그 학생의 등록상담 전건 팝오버(나머지 상담 열람). base-ui Menu는 body로
                  // portal되어 스크롤 컬럼에 안 잘리고, 트리거의 preventDefault/stopPropagation로 카드 창-내비를 막는다.
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <span
                          role="button"
                          tabIndex={0}
                          title={`이 학생의 등록상담 ${c.personConsultCount}건 — 눌러서 나머지 상담 보기`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          className="bg-amber-soft text-amber shrink-0 cursor-pointer rounded-full px-2 py-0.5 text-sm leading-none font-bold hover:brightness-95"
                        />
                      }
                    >
                      상담 {c.personConsultCount}건
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-64 p-1.5">
                      <div className="flex items-center justify-between gap-2 px-1 pb-1">
                        <p className="text-text-faint text-xs font-medium">
                          이 학생의 등록상담 {c.personConsultCount}건
                        </p>
                        {/* 🔴 쓰기 권한이 있을 때만 — 병합은 되돌릴 수 없다(서버도 같은 게이트를 다시 본다). */}
                        {draggable ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setMergeOpen(true);
                            }}
                            className="border-line text-text-dim hover:bg-bg-soft hover:text-foreground shrink-0 rounded-md border px-2 py-0.5 text-xs font-bold transition"
                            title="이 학생의 등록상담을 한 건으로 합칩니다"
                          >
                            병합
                          </button>
                        ) : null}
                      </div>
                      {c.personConsults.map((s) => {
                        const op = OUTCOME_PILL[s.outcome] ?? OUTCOME_PILL.pending!;
                        const sl = s.subject ? subjectLabelOf(s.subject) : null;
                        return (
                          <WindowLink
                            key={s.id}
                            href={`/enrollment/${s.id}`}
                            title={s.prospectName}
                            className={`hover:bg-bg-soft flex items-center justify-between gap-2 rounded-md px-2 py-1.5 ${
                              s.id === c.id ? "bg-bg-soft/60" : ""
                            }`}
                          >
                            <span className="num text-text-dim text-xs">
                              {new Date(s.consultedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}
                            </span>
                            <span className="flex items-center gap-1.5">
                              {sl ? <span className="text-foreground text-xs">{sl}</span> : null}
                              <Pill color={op.color}>{op.label}</Pill>
                            </span>
                          </WindowLink>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                {/* 출처·동시편집 표식 — 이름이 아니라 이것들이 줄어들면 뜻이 사라진다(shrink-0). */}
                {c.syncAddedAt ? (
                  <span className="shrink-0">
                    <MakeeduOriginTag />
                  </span>
                ) : null}
                <span className="shrink-0">
                  <EditingBadge scope={`consultation:${c.id}`} />
                </span>
              </p>
            </div>
            <CardMarkBadge mark={mark} hasAiAnalysis={c.hasAiAnalysis || c.outcome === "ai_done"} />
          </div>
          {/* 감춘 줄들의 자리 — 시각만 남긴다(상담사·요약은 위 title). */}
          <div className="text-text-faint mt-1 flex items-center justify-end text-sm">
            <span className="num">
              <RelativeTime iso={c.consultedAt} nowMs={nowMs} />
            </span>
          </div>
        </WindowLink>
      </div>
      {/* ⚠️ 링크(WindowLink) **바깥**에 둔다 — 안에 있으면 다이얼로그 클릭이 카드 창 열기로 샌다.
          병합 뒤에는 보드에 남아 새로고침만 한다(상세로 튕기지 않는다 — onMerged). */}
      {mergeOpen ? (
        <MergeDialog
          ids={c.personConsults.map((s) => s.id)}
          currentId={c.id}
          onClose={() => setMergeOpen(false)}
          onMerged={() => router.refresh()}
        />
      ) : null}
    </li>
  );
}

/**
 * 칸마다 최대 하나인 표식. 판정은 [board-stages](@/features/enrollment/board-stages)가 하고 여기선 그린다.
 *
 * 🎙 **녹음 = 마이크 아이콘 하나**(원장 지시는 "녹음기 이모지"였다). 이모지 대신 디자인 시스템의
 *    `mic` 글리프를 쓴다 — 아이콘 자리에 이모지를 넣는 것은 전역 가드가 막는 규칙이라
 *    (`eywa-icon-mapping.test.ts`) 이모지를 넣으면 다음 사람이 다시 걷어낸다. 지시의 핵심인
 *    **"녹음기 + AI 두 개를 달지 말 것"**은 그대로다 — 녹음이 있으면 이 표식 하나뿐이다.
 *
 * ⚠️ 어느 모양이든 **28px(이름 줄 높이) 안에** 들어가야 한다 — 넘치면 그 카드만 키가 커져 "카드 크기
 *    통일"이 깨진다(그래서 알약엔 `leading-none`, 마이크는 `size-7`).
 */
function CardMarkBadge({ mark, hasAiAnalysis }: { mark: CardMark; hasAiAnalysis: boolean }) {
  if (mark === "assigned") {
    return (
      <Pill color="primary" size="md" className="shrink-0 leading-none">
        {ASSIGNED_LABEL}
      </Pill>
    );
  }
  if (mark === "qr") {
    return (
      <Pill color="primary" size="md" className="shrink-0 leading-none">
        {QR_INTAKE_LABEL}
      </Pill>
    );
  }
  if (mark === "audio") {
    return (
      <span
        title={`녹음 상담 · ${hasAiAnalysis ? "AI 분석 완료" : "AI 분석 전"}`}
        aria-label={`녹음 상담 · ${hasAiAnalysis ? "AI 분석 완료" : "AI 분석 전"}`}
        className="bg-blue-soft text-blue rounded-pill inline-flex size-7 shrink-0 items-center justify-center"
      >
        <EyIcon name="mic" size={15} />
      </span>
    );
  }
  return null;
}
