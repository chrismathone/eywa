"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { BookMarked, Check, FileDown, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { AccountSetting } from "@/features/owner/settings-types";
import {
  deleteTextbookRequest,
  requestTextbook,
  updateTextbookRequest,
} from "@/features/billing/server/textbook-actions";
import type { StudentOption, TextbookOrderRow } from "@/features/billing/server/textbook-queries";
import type { CatalogOption } from "@/features/billing/server/catalog-queries";
import { TextbookRequestCardBody } from "@/app/(print)/textbook/[id]/print/textbook-request-card-body";
import { downloadCardPng } from "@/app/(print)/textbook/[id]/print/download-card";

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
            className={`inline-flex w-[40px] shrink-0 items-center justify-center gap-0.5 rounded-sm border py-0.5 text-[11px] font-medium ${
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

function RequestRow({
  row,
  onDownload,
}: {
  row: TextbookOrderRow;
  onDownload: (r: TextbookOrderRow) => void;
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
    <li className="bg-card flex items-center gap-3 px-3 py-2.5 text-[13px]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-foreground truncate font-medium">{row.bookName}</span>
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
      {canManage ? (
        confirmDel ? (
          <span className="flex shrink-0 items-center gap-1 text-[12px]">
            <button type="button" onClick={remove} disabled={pending} className="text-danger font-semibold">삭제</button>
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

export function TextbookRequestClient({
  rows,
  students,
  catalog,
  isTeacher,
  academyName,
  logoUrl,
  account,
}: {
  rows: TextbookOrderRow[];
  students: StudentOption[];
  catalog: CatalogOption[];
  isTeacher: boolean;
  academyName: string;
  logoUrl: string | null;
  account: AccountSetting;
}) {
  // 성공 시 목록은 서버 액션 revalidatePath로 자동 갱신. 폼 값은 유지(같은 학생 다른 교재 연속 요청에 편함).
  const [state, formAction, pending] = useActionState(requestTextbook, undefined);

  // 교재명·비고·금액은 '교재 검색'(단가표) 선택이 자동 채우므로 controlled(사무실 textbook-dialog 패턴).
  // 메모도 controlled — React19 form action은 uncontrolled만 자동 리셋해 "폼 값 유지" 정책이 필드별로 갈라지는 것 방지.
  const [bookName, setBookName] = useState("");
  const [bookDetail, setBookDetail] = useState("");
  const [price, setPrice] = useState<number | string>("");
  const [notes, setNotes] = useState("");

  // 바로 다운로드 — 요청의 카드를 화면 밖에 렌더 → html2canvas → PNG 저장(새 탭·창 없음).
  // k는 dl 상태에서만 파생(updater) — remount 키 충돌 없이 단조 증가.
  const [dl, setDl] = useState<{ row: TextbookOrderRow; k: number } | null>(null);
  const hiddenRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dl) return;
    let cancelled = false;
    // 로고 이미지 로드 후 canvas가 정확하도록 짧게 지연. setState 없음(다운로드만) → effect 규칙 안전.
    const t = setTimeout(() => {
      if (cancelled || !hiddenRef.current) return;
      void downloadCardPng(hiddenRef.current, dl.row.requestDate, dl.row.studentName, dl.row.bookName);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [dl]);
  const download = (row: TextbookOrderRow) => setDl((prev) => ({ row, k: (prev?.k ?? 0) + 1 }));

  // 저장 성공 → 요청서 PNG 자동 다운로드(ijw '이미지 저장 및 기록' 패리티). revalidation으로 새 행이
  // rows에 도착한 렌더에서 1회만 발화 — 렌더 중 상태조정(#25 회피) + createdId 키 가드(#67).
  const [handledId, setHandledId] = useState<string | null>(null);
  const createdId = state?.ok ? state.createdId : undefined;
  if (createdId && createdId !== handledId) {
    const createdRow = rows.find((r) => r.id === createdId);
    if (createdRow) {
      setHandledId(createdId);
      setDl((prev) => ({ row: createdRow, k: (prev?.k ?? 0) + 1 }));
    }
  }

  const options = students.map((s) => ({ value: s.id, label: s.name, hint: s.grade ?? undefined }));
  // 교재 검색 옵션 — 타이핑하면 SearchableSelect가 즉시 필터. hint에 가격(+상세)을 보여 고르기 쉽게.
  const catalogOptions = catalog.map((c) => ({
    value: c.id,
    label: c.title,
    hint: `${c.price.toLocaleString()}원${c.bookDetail ? ` · ${c.bookDetail}` : ""}`,
  }));
  const pickCatalog = (id: string) => {
    const c = catalog.find((x) => x.id === id);
    if (!c) return;
    setBookName(c.title);
    setBookDetail(c.bookDetail ?? "");
    setPrice(c.price);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <header className="flex items-center gap-2">
        <BookMarked className="text-primary size-5" />
        <div>
          <h1 className="text-foreground text-[19px] font-bold">교재 요청</h1>
          <p className="text-text-dim text-[13px]">
            {isTeacher
              ? "담당 학생의 교재를 요청하면 사무실에서 주문·납부를 처리합니다. 요청서는 바로 다운로드할 수 있습니다."
              : "교재 요청 목록 — 사무실은 수납관리 › 교재에서 주문·납부를 처리합니다."}
          </p>
        </div>
      </header>

      {/* 요청 폼 */}
      <section className="border-line bg-card rounded-md border p-4">
        <h2 className="text-foreground mb-3 flex items-center gap-1.5 text-[13px] font-bold">
          <Plus className="size-4" /> 새 교재 요청
        </h2>
        {students.length === 0 ? (
          <p className="text-text-dim text-[13px]">담당 학생이 없어 교재를 요청할 수 없습니다.</p>
        ) : (
          <form action={formAction} className="grid gap-3 sm:grid-cols-2">
            {catalogOptions.length > 0 ? (
              <label className="space-y-1 sm:col-span-2">
                <span className="text-text-dim text-[12px] font-medium">교재 검색 (단가표에서 불러오기)</span>
                {/* value=""(controlled) — 선택 후 placeholder로 복귀하는 '불러오기' 동작(아래 교재명을 손으로 고쳐도 표시 불일치 없음) */}
                <SearchableSelect
                  value=""
                  options={catalogOptions}
                  placeholder="교재명을 입력해 검색..."
                  searchPlaceholder="교재명 검색..."
                  ariaLabel="교재 단가표 검색"
                  onValueChange={pickCatalog}
                />
                <span className="text-text-faint text-[11px]">선택하면 교재명·비고·금액이 자동으로 채워집니다 (직접 수정 가능)</span>
              </label>
            ) : null}
            <label className="space-y-1">
              <span className="text-text-dim text-[12px] font-medium">
                학생 <span className="text-danger">*</span>
              </span>
              <SearchableSelect name="studentId" options={options} placeholder="학생 선택..." ariaLabel="교재 요청 학생 선택" />
              {state?.fieldErrors?.studentId ? (
                <span className="text-danger text-[11px]">{state.fieldErrors.studentId}</span>
              ) : null}
            </label>
            <label className="space-y-1">
              <span className="text-text-dim text-[12px] font-medium">
                교재명 <span className="text-danger">*</span>
              </span>
              <Input
                name="bookName"
                value={bookName}
                onChange={(e) => setBookName(e.target.value)}
                placeholder="예: 쎈 중등수학 2-1"
              />
              {state?.fieldErrors?.bookName ? (
                <span className="text-danger text-[11px]">{state.fieldErrors.bookName}</span>
              ) : null}
            </label>
            <label className="space-y-1">
              <span className="text-text-dim text-[12px] font-medium">비고(선택)</span>
              <Input
                name="bookDetail"
                value={bookDetail}
                onChange={(e) => setBookDetail(e.target.value)}
                placeholder="예: 3권, 개정판"
              />
            </label>
            <label className="space-y-1">
              <span className="text-text-dim text-[12px] font-medium">금액(선택)</span>
              <Input
                name="price"
                type="number"
                min={0}
                step={500}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="교재 검색 시 자동 입력"
                className="num text-right"
              />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-text-dim text-[12px] font-medium">메모(선택)</span>
              <Input name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="사무실 전달 메모" />
            </label>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Button type="submit" disabled={pending}>
                {pending ? "요청 중…" : "교재 요청"}
              </Button>
              {state?.error ? <span className="text-danger text-[12px]">{state.error}</span> : null}
              {state?.ok ? (
                <span className="text-primary text-[12px]">
                  요청되었습니다 — 요청서 이미지가 자동 저장됩니다. (목록의 &lsquo;요청서&rsquo;로 다시 받을 수 있어요)
                </span>
              ) : null}
            </div>
          </form>
        )}
      </section>

      {/* 요청 목록 + 진행상태 */}
      <section className="space-y-2">
        <h2 className="text-text-dim text-[12px] font-bold">요청 목록 ({rows.length})</h2>
        {rows.length === 0 ? (
          <p className="text-text-faint border-line rounded-md border border-dashed p-6 text-center text-[13px]">
            아직 교재 요청이 없습니다.
          </p>
        ) : (
          <ul className="divide-line border-line divide-y overflow-hidden rounded-md border">
            {rows.map((r) => (
              <RequestRow key={r.id} row={r} onDownload={download} />
            ))}
          </ul>
        )}
      </section>

      {/* 바로 다운로드용 숨김 카드 — 화면 밖에서 html2canvas 대상. 클릭 시에만 렌더(key로 remount). */}
      {dl ? (
        <div aria-hidden style={{ position: "fixed", left: -99999, top: 0, width: 720, pointerEvents: "none" }}>
          <TextbookRequestCardBody
            key={dl.k}
            cardRef={hiddenRef}
            data={{
              studentName: dl.row.studentName,
              teacherName: dl.row.teacherName,
              requestDate: dl.row.requestDate,
              bookName: dl.row.bookName,
              bookDetail: dl.row.bookDetail,
              price: dl.row.price,
            }}
            academyName={academyName}
            logoUrl={logoUrl}
            account={account}
          />
        </div>
      ) : null}
    </div>
  );
}
