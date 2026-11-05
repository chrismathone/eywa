"use client";

import {
  TOOLBAR_SEG_BOX,
  TOOLBAR_SEG_ITEM,
  TOOLBAR_SEG_OFF,
  TOOLBAR_SEG_ON,
} from "@/components/toolbar-controls";

import { useMemo, useState, useTransition } from "react";
import { Check, FileDown, Pencil, Search, Trash2 } from "@/components/icons/aywa-icon-compat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PAGER_LABEL,
  PAGER_STEP_BASE,
  PAGER_STEP_DISABLED,
  PAGER_STEP_ENABLED,
} from "@/components/pagination";
import {
  deleteTextbookRequest,
  updateTextbookRequest,
} from "@/features/billing/server/textbook-actions";
import type { TextbookOrderRow } from "@/features/billing/server/textbook-queries";
import { ownsTextbookRequest } from "@/features/billing/textbook-ownership";
import { textbookOrderSettled } from "@/features/billing/textbook-progress";

// 교재요청 '요청 내역' — ijw TextbookRequestView history 구조 이식: 미완료/완료 필터 탭(건수 배지)
// + 학생명·교재명 검색 + 메모리 페이지네이션(rows는 이미 서버에서 도착 — 강사 스코프 수백 행 수준).
// 완료 판정 = ijw isFullyComplete(등록·납부·주문 3체크 전부).

const PAGE_SIZE = 50;

// ijw식 3개 독립 체크(등록·납부·주문) — 사무실 표(textbooks-table)와 동일 색·순서. 강사 뷰는 읽기전용
// (사무실이 /billing에서 토글, 강사는 진행상태만 확인). 체크됨=솔리드 색, 미완료=회색.
const PROGRESS_CHECKS: { key: "registered" | "paid" | "ordered"; label: string; on: string }[] = [
  { key: "registered", label: "등록", on: "bg-primary text-primary-foreground border-primary" },
  { key: "paid", label: "납부", on: "bg-blue text-white border-blue" },
  { key: "ordered", label: "주문", on: "bg-amber text-white border-amber" },
];

/** 진행상태(등록·납부·주문) 읽기전용 배지 그룹 — 사무실이 찍은 3개 상태를 그대로 표시. */
function ProgressChecks({ row }: { row: TextbookOrderRow }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {PROGRESS_CHECKS.map((c) => {
        const on = row[c.key];
        return (
          // 2026-09-08 v5 글자 기준 실측: text-xs 14px 한글 2자 24.2 + 아이콘 12 + gap 2 + border 2 = 40.2px라 40px에선 '등'/'록'으로 접혔다 → 44px.
          <span
            key={c.key}
            title={on ? `${c.label} 완료` : `${c.label} 대기`}
            className={`inline-flex w-[44px] shrink-0 items-center justify-center gap-0.5 rounded-full border py-0.5 text-xs font-medium ${
              on ? c.on : "border-line text-text-faint"
            }`}
          >
            {on ? <Check className="size-3" strokeWidth={2.5} /> : null}
            {c.label}
          </span>
        );
      })}
    </div>
  );
}

/** 사무실이 아무것도 처리 안 함(등록/주문/납부 체크 0) → 강사가 수정·삭제 가능. */
function isUntouched(r: TextbookOrderRow): boolean {
  return !r.registered && !r.ordered && !r.paid;
}

/** ijw isFullyComplete — 등록·납부·주문 3개 전부 체크 = 완료(미완료/완료 탭 판정). 판정은 단일 소스(2026-08-20). */
const isDone = textbookOrderSettled;

function RequestRow({
  row,
  onDownload,
  onSend,
  ownerName,
  viewerUserId,
  canWrite,
}: {
  row: TextbookOrderRow;
  /** 교재 요청 쓰기 권한(서버 게이트와 같은 판정). false면 수정·삭제를 그리지 않는다. */
  canWrite: boolean;
  onDownload: (r: TextbookOrderRow) => void;
  /** 학부모 알림장 발송 다이얼로그 열기(없으면 버튼 미노출). */
  onSend?: (r: TextbookOrderRow) => void;
  /** 보는 사람 계정 id — 소유 판정 합집합(0174a). 이름이 달라도 본인이 만든 요청은 본인 것. */
  viewerUserId?: string;
  /** 강사일 때만 지정 — 본인 요청이 아니면 수정·삭제·발송을 숨긴다(서버 게이트 미러). */
  ownerName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [bookName, setBookName] = useState(row.bookName);
  const [bookDetail, setBookDetail] = useState(row.bookDetail ?? "");
  const [notes, setNotes] = useState(row.notes ?? "");
  const [price, setPrice] = useState<number | string>(row.price);
  // 소유 판정 = 서버 게이트와 **같은 순수 함수**. ownerName 미지정(사무실)이면 전부 내 것처럼 다룬다
  // (사무실은 effectiveTeacherId()가 null이라 서버에서도 이 게이트를 안 탄다 — 두 쪽이 같은 말을 한다).
  // 🔴 이름이 안 맞아 버튼이 통째로 사라지던 자리(원장 2026-08-03 "삭제 버튼이 없다 … 이름 때문인가?").
  //    합집합: **내가 만든 것** OR 내 이름으로 된 것(0174a). 대리 작성 의미는 그대로 둔다.
  const mine = !ownerName || ownsTextbookRequest(row.teacherName, ownerName, row.createdBy, viewerUserId);
  // 🔴 쓰기 권한이 먼저다 — 사무실은 ownerName이 없어 mine이 늘 참이라, 이것 없이는 읽기 권한에게도 수정·삭제가 떴다.
  const canManage = canWrite && mine && isUntouched(row);
  const done = isDone(row);

  const openEdit = () => {
    setBookName(row.bookName);
    setBookDetail(row.bookDetail ?? "");
    setNotes(row.notes ?? "");
    setPrice(row.price);
    setErr(null);
    setEditing(true);
  };

  const save = () => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", row.id);
      fd.set("bookName", bookName);
      fd.set("bookDetail", bookDetail);
      fd.set("notes", notes);
      fd.set("price", String(price));
      const res = await updateTextbookRequest(undefined, fd);
      if (res?.ok) setEditing(false);
      else setErr(res?.error ?? res?.fieldErrors?.bookName ?? "저장에 실패했습니다");
    });
  };

  const remove = () => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", row.id);
      const res = await deleteTextbookRequest(undefined, fd);
      if (!res?.ok) setErr(res?.error ?? "삭제에 실패했습니다"); // 성공 시 revalidation으로 행 제거
    });
  };

  if (editing) {
    return (
      <li className="bg-card space-y-2 px-3 py-2.5 text-sm">
        <div className="grid gap-2 sm:grid-cols-4">
          <Input value={bookName} onChange={(e) => setBookName(e.target.value)} placeholder="교재명" aria-label="교재명" />
          <Input value={bookDetail} onChange={(e) => setBookDetail(e.target.value)} placeholder="비고" aria-label="비고" />
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="메모" aria-label="메모" />
          <Input
            type="number"
            min={0}
            step={500}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="금액(원)"
            aria-label="금액"
            className="num text-right"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save} disabled={pending}>{pending ? "저장 중…" : "저장"}</Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={pending}>취소</Button>
          {err ? <span className="text-danger text-xs">{err}</span> : null}
        </div>
      </li>
    );
  }

  return (
    <li className={`bg-card flex items-center gap-3 px-3 py-2.5 text-sm ${done ? "opacity-60" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {/* ijw 패리티 — 완료(3체크) 행은 회색 + 교재명 취소선 */}
          <span className={`text-foreground truncate font-medium ${done ? "line-through" : ""}`}>{row.bookName}</span>
          {row.bookDetail ? <span className="text-text-faint truncate text-xs">{row.bookDetail}</span> : null}
          {/* 같은 줄이 둘일 때 어느 쪽이 학부모에게 나간 요청인지 — 없어서 발송한 쪽을 지운 9건(2026-10-20). */}
          {row.classnoteNoticeId ? (
            <span className="text-primary shrink-0 text-xs font-medium" title="이 요청은 학부모 알림장으로 발송했습니다">
              발송함
            </span>
          ) : null}
        </div>
        <div className="text-text-dim mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {row.studentName ? <span>{row.studentName}</span> : null}
          {/* 요청 선생님 — 남의 요청인 줄 알 방법이 없어 수정·삭제·발송까지 열려 있던 게 2026-07-29 감사의 발견.
              권한은 서버가 막고, 화면은 **왜 버튼이 없는지**를 이 이름으로 설명한다. */}
          {row.teacherName && !mine ? (
            <span className="text-text-faint">· 요청 {row.teacherName}</span>
          ) : null}
          {row.requestDate ? <span className="text-text-faint">· {row.requestDate}</span> : null}
          {row.price > 0 ? <span className="num text-text-faint">· {row.price.toLocaleString()}원</span> : null}
          {row.notes ? <span className="text-text-faint">· {row.notes}</span> : null}
        </div>
        {err ? <div className="text-danger mt-0.5 text-xs">{err}</div> : null}
      </div>
      <ProgressChecks row={row} />
      <button
        type="button"
        onClick={() => onDownload(row)}
        className="text-text-faint hover:text-primary inline-flex shrink-0 items-center gap-1 text-xs"
        title="교재요청서 바로 다운로드(PNG)"
      >
        <FileDown className="size-3.5" /> 요청서
      </button>
      {/* 발송은 **본인 요청만** — 서버 loadScopedOrders가 같은 조건으로 거절한다(2026-07-29). */}
      {onSend && mine ? (
        <button
          type="button"
          onClick={() => onSend(row)}
          className="text-text-faint hover:text-primary inline-flex shrink-0 items-center gap-1 text-xs"
          title="이 요청을 학부모 알림장으로 발송"
        >
          <EyIcon name="send" size={14} /> 발송
        </button>
      ) : null}
      {canManage ? (
        confirmDel ? (
          <span className="flex shrink-0 items-center gap-1 text-xs">
            {row.classnoteNoticeId ? (
              <span className="text-danger break-keep">학부모에게 보낸 요청입니다 — 지워도 알림장 글은 남아요.</span>
            ) : null}
            <button type="button" onClick={remove} disabled={pending} className="text-danger font-bold">삭제</button>
            <button type="button" onClick={() => setConfirmDel(false)} className="text-text-faint">취소</button>
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5">
            <button type="button" onClick={openEdit} className="text-text-faint hover:text-foreground" title="수정" aria-label="수정">
              <Pencil className="size-3.5" />
            </button>
            <button type="button" onClick={() => setConfirmDel(true)} className="text-text-faint hover:text-danger" title="삭제" aria-label="삭제">
              <Trash2 className="size-3.5" />
            </button>
          </span>
        )
      ) : canWrite && mine ? (
        /* 사무실이 이미 손댄 건(등록·주문·납부 중 하나라도) — 지우면 처리 이력이 사라지므로 강사가 못 지운다.
           🔴 버튼만 없애고 아무 말도 안 하면 "왜 안 되지"로 끝난다(원장 2026-08-03 "삭제가 안 되는 것 같은데").
           할 수 없는 이유와 다음 행동을 같이 적는다. */
        <span
          className="text-text-faint shrink-0 text-xs whitespace-nowrap"
          title="등록·주문·납부 중 하나라도 처리되면 요청서를 지울 수 없습니다 — 사무실 장부와 어긋나기 때문입니다"
        >
          사무실 처리됨 · 관리자에게 문의
        </span>
      ) : null}
    </li>
  );
}

export function RequestHistory({
  rows,
  onDownload,
  onSend,
  capNote,
  ownerName,
  viewerUserId,
  canWrite,
}: {
  rows: TextbookOrderRow[];
  onDownload: (r: TextbookOrderRow) => void;
  /**
   * 교재 요청 쓰기 권한 — 서버 게이트(`canWriteTenant("textbook_requests")`)와 같은 판정을 page.tsx가 계산해 내린다.
   * false(읽기 권한)면 수정·삭제·발송을 **그리지 않는다**(원장 2026-11-05 — 소유 판정만으로는 사무실 readonly에게 전부 열렸다).
   */
  canWrite: boolean;
  /** 학부모 알림장 발송 진입점(행마다). 없으면 발송 버튼 미노출. */
  onSend?: (r: TextbookOrderRow) => void;
  /** rows가 절단본일 때(사무실=최근 100건) 카운트가 전체 통계로 읽히지 않게 붙이는 안내. */
  capNote?: string;
  /**
   * 소유 판정 기준 이름 — **강사일 때만** 넘긴다(사무실은 undefined = 전 행 관리 가능).
   * 서버 게이트(`ownsTextbookRequest`)와 **같은 함수**로 판정해 "눌리는데 서버가 거절"이 안 생기게 한다.
   */
  ownerName?: string;
  /** 보는 사람 계정 id — 소유 판정 합집합(0174a). */
  viewerUserId?: string;
}) {
  // ijw 기본 탭 = 미완료(처리 중인 것부터). 탭·검색 변경 시 페이지 1 리셋(이벤트 핸들러에서).
  const [tab, setTab] = useState<"incomplete" | "complete">("incomplete");
  const [q, setQ] = useState("");
  const [pageState, setPageState] = useState(1);

  const counts = useMemo(() => {
    let complete = 0;
    for (const r of rows) if (isDone(r)) complete += 1;
    return { complete, incomplete: rows.length - complete };
  }, [rows]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab === "complete" ? !isDone(r) : isDone(r)) return false;
      if (!term) return true;
      return (
        (r.studentName ?? "").toLowerCase().includes(term) || r.bookName.toLowerCase().includes(term)
      );
    });
  }, [rows, tab, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(pageState, totalPages); // revalidation으로 행이 줄어도 파생 클램프(effect 불요)
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const tabBtn = (key: "incomplete" | "complete", label: string, n: number) => (
    <button
      type="button"
      onClick={() => {
        setTab(key);
        setPageState(1);
      }}
      className={`${TOOLBAR_SEG_ITEM} font-medium whitespace-nowrap ${
        tab === key ? TOOLBAR_SEG_ON : TOOLBAR_SEG_OFF
      }`}
    >
      {label} <span className="num">{n}</span>
    </button>
  );

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <h2 className="text-text-dim mr-2 text-xs font-bold">요청 내역</h2>
          <div className={TOOLBAR_SEG_BOX}>
            {tabBtn("incomplete", "미완료", counts.incomplete)}
            {tabBtn("complete", "완료", counts.complete)}
          </div>
          {capNote ? <span className="text-text-faint ml-1 text-xs">({capNote})</span> : null}
        </div>
        <div className="relative">
          <Search className="text-text-faint pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPageState(1);
            }}
            placeholder="학생명, 교재명 검색..."
            aria-label="요청 내역 검색"
            className="w-56 pl-8"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-text-faint border-line rounded-2xl border border-dashed p-6 text-center text-sm">
          {q.trim()
            ? "검색 결과가 없습니다."
            : tab === "incomplete"
              ? "미완료 요청이 없습니다."
              : "완료된 요청이 없습니다."}
        </p>
      ) : (
        // 페이지 넘길 때 페이저가 위로 튀지 않게(클라 state 페이저 표준) 다페이지면 목록 높이 고정.
        <ul
          className={`divide-line border-line divide-y rounded-2xl border ${
            totalPages > 1 ? "h-[60vh] overflow-y-auto" : "overflow-hidden"
          }`}
        >
          {pageRows.map((r) => (
            <RequestRow
              key={r.id}
              row={r}
              onDownload={onDownload}
              onSend={canWrite ? onSend : undefined}
              ownerName={ownerName}
              viewerUserId={viewerUserId}
              canWrite={canWrite}
            />
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <nav className="flex items-center justify-center gap-1" aria-label="요청 내역 페이지">
          <button
            type="button"
            onClick={() => setPageState(Math.max(1, page - 1))}
            disabled={page <= 1}
            className={`${PAGER_STEP_BASE} ${page <= 1 ? PAGER_STEP_DISABLED : PAGER_STEP_ENABLED}`}
          >
            <EyIcon name="chevronLeft" size={12} />
            이전
          </button>
          <span className={PAGER_LABEL}>
            {page} / {totalPages} · {filtered.length}건
          </span>
          <button
            type="button"
            onClick={() => setPageState(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className={`${PAGER_STEP_BASE} ${page >= totalPages ? PAGER_STEP_DISABLED : PAGER_STEP_ENABLED}`}
          >
            다음
            <EyIcon name="chevronRight" size={12} />
          </button>
        </nav>
      ) : null}
    </section>
  );
}
