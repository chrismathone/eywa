"use client";

// 교재요청 발송 다이얼로그의 '받는 학생' 목록 — 학생별로 어느 알림장(과목 보드)으로 갈지 확정/선택한다.
// 과목 1개=자동 확정 표시, 2개+=선택, 0개=발송 불가(비활성). 학생 연결이 없는 요청도 사유와 함께 드러낸다.

import { SearchableSelect } from "@/components/ui/searchable-select";
import type {
  TextbookNoticeOrder,
  TextbookNoticeSkip,
} from "@/features/billing/server/textbook-notice-actions";

/** 제외 사유 한글 라벨 — raw 영문 코드는 화면에 절대 노출하지 않는다. */
const SKIP_LABEL: Record<TextbookNoticeSkip["reason"], string> = {
  no_subject: "수강 과목 없음",
  no_student: "학생 연결 없음",
  name_collision: "동명이인 — 오발송 방지로 제외",
  subject_off: "학원설정에서 발송하지 않는 과목",
  no_name: "이름 없음",
};

/** 발송 결과에서 빠진 학생 — "N명 발송" 뒤에 조용히 사라지지 않도록 사유까지 한글로 남긴다. */
export function SendSkipList({ skipped }: { skipped: TextbookNoticeSkip[] }) {
  return (
    <div className="border-line rounded-2xl border p-3">
      <p className="text-text-dim text-[12px] font-medium">
        제외된 학생 <span className="num">{skipped.length}</span>명
      </p>
      <ul className="text-text-faint mt-1 space-y-0.5 text-[12px]">
        {skipped.map((s, i) => (
          <li key={`${s.name}-${s.reason}-${i}`}>
            {s.name} — {SKIP_LABEL[s.reason]}
          </li>
        ))}
      </ul>
    </div>
  );
}

export type SendTarget = {
  studentId: string;
  name: string;
  /** 발송 가능한 보드 과목 키(서버가 활성 수강에서 도출). 0개면 보낼 보드가 없다. */
  subjects: string[];
  orders: TextbookNoticeOrder[];
};

/** 같은 학생의 요청 여러 건은 한 보드에 한 글로 나간다(서버와 동일 그룹핑) — 화면도 학생 단위로 묶는다. */
export function groupTargets(orders: TextbookNoticeOrder[]) {
  const byStudent = new Map<string, SendTarget>();
  const orphans: TextbookNoticeOrder[] = [];
  for (const o of orders) {
    if (!o.studentId) {
      orphans.push(o);
      continue;
    }
    const t = byStudent.get(o.studentId) ?? {
      studentId: o.studentId,
      name: o.studentName ?? "이름 없음",
      subjects: o.subjects,
      orders: [],
    };
    t.orders.push(o);
    byStudent.set(o.studentId, t);
  }
  return { targets: [...byStudent.values()], orphans };
}

export function SendTargetList({
  targets,
  orphans,
  pick,
  onPick,
  labelOf,
}: {
  targets: SendTarget[];
  orphans: TextbookNoticeOrder[];
  /** studentId → 선택된 과목 키 */
  pick: Record<string, string>;
  onPick: (studentId: string, subject: string) => void;
  /** 과목 라벨(학원설정 단일 소스 — 하드코딩 금지) */
  labelOf: (key: string) => string;
}) {
  return (
    <ul className="divide-line border-line divide-y rounded-2xl border">
      {targets.map((t) => (
        <li key={t.studentId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
          <span className="text-foreground w-20 shrink-0 truncate font-medium">{t.name}</span>
          <span className="text-text-faint min-w-0 flex-1 truncate text-[12px]">
            {t.orders.map((o) => o.bookName).join(", ")}
          </span>
          {t.subjects.length === 0 ? (
            <span className="text-danger shrink-0 text-[11px]">
              발송 불가 — 수강 과목이 없어 학부모 보드를 찾을 수 없습니다
            </span>
          ) : t.subjects.length === 1 ? (
            <span className="text-text-dim shrink-0 text-[12px]">{labelOf(t.subjects[0]!)} 알림장</span>
          ) : (
            <SearchableSelect
              className="w-36 shrink-0"
              value={pick[t.studentId] ?? ""}
              options={t.subjects.map((s) => ({ value: s, label: `${labelOf(s)} 알림장` }))}
              onValueChange={(v) => onPick(t.studentId, v)}
              ariaLabel={`${t.name} 알림장 과목 선택`}
            />
          )}
        </li>
      ))}
      {orphans.map((o) => (
        <li key={o.id} className="flex items-center gap-2 px-3 py-2 text-[13px] opacity-60">
          <span className="text-foreground w-20 shrink-0 truncate">{o.studentName ?? "이름 없음"}</span>
          <span className="text-text-faint min-w-0 flex-1 truncate text-[12px]">{o.bookName}</span>
          <span className="text-danger shrink-0 text-[11px]">발송 불가 — 학생 연결 없음</span>
        </li>
      ))}
    </ul>
  );
}
