"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, FileDown, Pencil, Search, Trash2 } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
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
          <span
            key={c.key}
            title={on ? `${c.label} 완료` : `${c.label} 대기`}
            className={`inline-flex w-[40px] shrink-0 items-center justify-center gap-0.5 rounded-full border py-0.5 text-[11px] font-medium ${
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

/** ijw isFullyComplete — 등록·납부·주문 3개 전부 체크 = 완료(미완료/완료 탭 판정). */
function isDone(r: TextbookOrderRow): boolean {
  return r.registered && r.ordered && r.paid;
}

function RequestRow({
  row,
  onDownload,
  onSend,
}: {
  row: TextbookOrderRow;
  onDownload: (r: TextbookOrderRow) => void;
  /** 학부모 알림장 발송 다이얼로그 열기(없으면 버튼 미노출). */
  onSend?: (r: TextbookOrderRow) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [bookName, setBookName] = useState(row.bookName);
  const [bookDetail, setBookDetail] = useState(row.bookDetail ?? "");
  const [notes, setNotes] = useState(row.notes ?? "");
  const [price, setPrice] = useState<number | string>(row.price);
  const canManage = isUntouched(row);
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
      <li className="bg-card space-y-2 px-3 py-2.5 text-[13px]">
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
          {err ? <span className="text-danger text-[12px]">{err}</span> : null}
        </div>
      </li>
    );
  }

  return (
    <li className={`bg-card flex items-center gap-3 px-3 py-2.5 text-[13px] ${done ? "opacity-60" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {/* ijw 패리티 — 완료(3체크) 행은 회색 + 교재명 취소선 */}
          <span className={`text-foreground truncate font-medium ${done ? "line-through" : ""}`}>{row.bookName}</span>
          {row.bookDetail ? <span className="text-text-faint truncate text-[12px]">{row.bookDetail}</span> : null}
        </div>
        <div className="text-text-dim mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
          {row.studentName ? <span>{row.studentName}</span> : null}
          {row.requestDate ? <span className="text-text-faint">· {row.requestDate}</span> : null}
          {row.price > 0 ? <span className="num text-text-faint">· {row.price.toLocaleString()}원</span> : null}
          {row.notes ? <span className="text-text-faint">· {row.notes}</span> : null}
        </div>
        {err ? <div className="text-danger mt-0.5 text-[12px]">{err}</div> : null}
      </div>
      <ProgressChecks row={row} />
      <button
        type="button"
        onClick={() => onDownload(row)}
        className="text-text-faint hover:text-primary inline-flex shrink-0 items-center gap-1 text-[12px]"
        title="교재요청서 바로 다운로드(PNG)"
      >
        <FileDown className="size-3.5" /> 요청서
      </button>
      {onSend ? (
        <button
          type="button"
          onClick={() => onSend(row)}
          className="text-text-faint hover:text-primary inline-flex shrink-0 items-center gap-1 text-[12px]"
          title="이 요청을 학부모 알림장으로 발송"
        >
          <EyIcon name="send" size={14} /> 발송
        </button>
      ) : null}
      {canManage ? (
        confirmDel ? (
          <span className="flex shrink-0 items-center gap-1 text-[12px]">
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
      ) : null}
    </li>
  );
}

export function RequestHistory({
  rows,
  onDownload,
  onSend,
  capNote,
}: {
  rows: TextbookOrderRow[];
  onDownload: (r: TextbookOrderRow) => void;
  /** 학부모 알림장 발송 진입점(행마다). 없으면 발송 버튼 미노출. */
  onSend?: (r: TextbookOrderRow) => void;
  /** rows가 절단본일 때(사무실=최근 100건) 카운트가 전체 통계로 읽히지 않게 붙이는 안내. */
  capNote?: string;
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
      className={`rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap transition ${
        tab === key ? "bg-foreground text-background" : "text-text-dim hover:bg-bg-soft"
      }`}
    >
      {label} <span className="num">{n}</span>
    </button>
  );

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <h2 className="text-text-dim mr-2 text-[12px] font-bold">요청 내역</h2>
          {tabBtn("incomplete", "미완료", counts.incomplete)}
          {tabBtn("complete", "완료", counts.complete)}
          {capNote ? <span className="text-text-faint ml-1 text-[11px]">({capNote})</span> : null}
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
        <p className="text-text-faint border-line rounded-2xl border border-dashed p-6 text-center text-[13px]">
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
            <RequestRow key={r.id} row={r} onDownload={onDownload} onSend={onSend} />
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
