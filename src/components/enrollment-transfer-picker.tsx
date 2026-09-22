"use client";

import { EnrollmentBulkPicker } from "./enrollment-bulk-picker";
import type { BulkTransferController } from "./use-bulk-transfer";

export function EnrollmentTransferPicker({ transfer }: { transfer: BulkTransferController }) {
  return (
    <section className="border-border space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={transfer.toggle} aria-pressed={transfer.on}
          disabled={transfer.pending || transfer.completed.length > 0 || transfer.uncertain} className="text-primary text-sm font-medium disabled:opacity-50">
          단체 반 이동
        </button>
        {transfer.on ? <button type="button" onClick={transfer.reload} disabled={transfer.loading || transfer.pending}
          className="text-muted-foreground text-xs disabled:opacity-50">목록 새로고침</button> : null}
      </div>
      {!transfer.on ? <p className="text-muted-foreground text-xs">같은 반 학생을 함께 선택해 옮길 수 있습니다.</p> : <>
        <p className="text-muted-foreground text-xs">
          {transfer.className ? `${transfer.className}에서 ` : "같은 반에서 "}이동할 학생을 선택하세요.
          이동일과 등원 요일은 선택한 학생 모두에게 적용됩니다. 휴원 상태는 유지됩니다.
        </p>
        {transfer.loading ? <p role="status" className="text-muted-foreground text-sm">같은 반 학생을 불러오는 중…</p> : (
          <EnrollmentBulkPicker options={transfer.items} selected={transfer.ids} onChange={transfer.pick}
            disabled={transfer.pending || transfer.uncertain} blocked={transfer.blocked}
            descriptions={Object.fromEntries(transfer.items.map((c) => [c.id,
              `${c.snapshot.startDate}~${c.snapshot.endDate ?? ""}${c.snapshot.onHold ? " · 휴원" : ""}`]))}
            listLabel="이동할 학생 목록" emptyLabel="이동할 수 있는 학생이 없습니다" />
        )}
        {transfer.invalidSelection ? <p role="alert" className="text-danger text-xs">이동할 수 없는 학생의 선택을 해제하거나 이동일을 확인해 주세요.</p> : null}
        {transfer.error ? <p role="alert" className="text-danger text-sm">{transfer.error}</p> : null}
        {transfer.completed.length || transfer.failures.length ? <div role="status" className="bg-muted rounded-md p-2 text-xs">
          <p className="font-medium">{transfer.completed.length}명 이동 완료 · {transfer.failures.length}명 확인 필요</p>
          <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
            {transfer.failures.map((f) => <li key={f.id}>{f.name} — {f.error}</li>)}
          </ul>
        </div> : null}
        {transfer.uncertain ? <p className="text-danger text-xs">수강 내역을 확인하고 ‘목록 새로고침’을 눌러 주세요.</p> : null}
      </>}
    </section>
  );
}
