"use client";

// 교재요청 발송 다이얼로그의 '받는 학생' 목록 — 학생별로 어느 알림장(과목 보드)으로 갈지 확정/선택한다.
// 과목 1개=자동 확정 표시, 2개+=선택, 0개=발송 불가(비활성). 학생 연결이 없는 요청도 사유와 함께 드러낸다.

import { SearchableSelect } from "@/components/ui/searchable-select";
import type { PreparedTextbookNotice, TextbookNoticeOrder, TextbookNoticeSkip } from "@/features/billing/textbook-notice-types";
import { NOTICE_SKIP_LABEL } from "@/features/report-admin/notice-targets";
import { SEND_CLASS_SUBJECTS } from "@/features/onescreen/send-class";

type MathRoute = NonNullable<PreparedTextbookNotice["mathRoute"]>;
type Standing = NonNullable<PreparedTextbookNotice["standing"]>;

/**
 * 이 학생을 이 과목 알림장으로 **보낼 수 없는 사유**(없으면 null) — 수업 시작 전·휴원(대기) 중(원장 2026-11-05)이 먼저,
 * 그다음 수학 반 보드 경로의 사유. 발송 인원 세기와 목록 표시가 같은 판정을 쓴다(화면에 "N명 발송"이 실제로 나가는 수와 같게).
 */
export function sendBlockOf(route: MathRoute | undefined, standing: Standing | undefined, studentId: string, subject: string | undefined) {
  if (!subject) return null;
  const s = standing?.[studentId]?.[subject];
  if (s) return s;
  const r = mathRouteOf(route, studentId, subject);
  return r && "blocked" in r ? r.blocked : null;
}

/**
 * 이 학생의 수학 알림장이 가는 곳 — 반 보드 경로가 켜져 있을 때만 값이 있다(없으면 지금까지처럼 1인 보드).
 * `blocked`면 수학 알림장으로는 보낼 수 없다(받을 반 보드가 없다 · 보내는 선생님의 반이 아니다).
 */
export function mathRouteOf(route: MathRoute | undefined, studentId: string, subject: string | undefined) {
  if (!route || !subject || !SEND_CLASS_SUBJECTS.has(subject)) return null;
  const r = route[studentId];
  if (!r) return { blocked: "no_class_board" as const };
  return "className" in r ? { className: r.className } : { blocked: r.reason };
}

/** 제외 사유 한글 라벨 — raw 영문 코드는 화면에 절대 노출하지 않는다. */
const SKIP_LABEL: Record<TextbookNoticeSkip["reason"], string> = {
  no_subject: "수강 과목 없음",
  no_student: "학생 연결 없음",
  // 공지 레일의 제외 사유는 한 벌(notice-targets.ts) — 수학 반 보드 경로의 사유 포함.
  ...NOTICE_SKIP_LABEL,
  // 중복 발송 차단(0174a) — 수업보고서가 이미 발송된 건을 다시 못 보내게 하는 것과 같은 규약.
  already_sent: "이미 발송한 요청서 — 다시 보내려면 학부모 공지를 게시취소하세요",
  same_book_sent: "같은 교재가 이미 발송됨 — 중복 요청서입니다",
  dup_in_batch: "이번 발송에 같은 교재가 중복으로 담김 — 한 건만 보냅니다",
};

/** 발송 결과에서 빠진 학생 — "N명 발송" 뒤에 조용히 사라지지 않도록 사유까지 한글로 남긴다. */
export function SendSkipList({ skipped }: { skipped: TextbookNoticeSkip[] }) {
  return (
    <div className="border-line rounded-2xl border p-3">
      <p className="text-text-dim text-xs font-medium">
        제외된 학생 <span className="num">{skipped.length}</span>명
      </p>
      <ul className="text-text-faint mt-1 space-y-0.5 text-xs">
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
  mathRoute,
  standing,
}: {
  targets: SendTarget[];
  orphans: TextbookNoticeOrder[];
  /** studentId → 선택된 과목 키 */
  pick: Record<string, string>;
  onPick: (studentId: string, subject: string) => void;
  /** 과목 라벨(학원설정 단일 소스 — 하드코딩 금지) */
  labelOf: (key: string) => string;
  /** 수학 알림장이 가는 반 보드(서버 판정) — 없으면 지금까지처럼 1인 보드. */
  mathRoute?: MathRoute;
  /** 수업 시작 전·휴원(대기) 중이라 그 과목 알림장으로 못 보내는 학생(서버 판정 · 원장 2026-11-05). */
  standing?: Standing;
}) {
  // 알림장 라벨 — 수학 반 보드 경로면 어느 반으로 가는지까지 적는다("수학 알림장 · 중등M 중2 BS3O").
  const boardLabel = (studentId: string, subject: string) => {
    const r = mathRouteOf(mathRoute, studentId, subject);
    return `${labelOf(subject)} 알림장${r && "className" in r ? ` · ${r.className}` : ""}`;
  };
  const blockedOf = (studentId: string, subject: string | undefined) => sendBlockOf(mathRoute, standing, studentId, subject);
  return (
    <ul className="divide-line border-line divide-y rounded-2xl border">
      {targets.map((t) => (
        <li key={t.studentId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <span className="text-foreground w-20 shrink-0 truncate font-medium">{t.name}</span>
          <span className="text-text-faint min-w-0 flex-1 truncate text-xs">
            {t.orders.map((o) => o.bookName).join(", ")}
          </span>
          {t.subjects.length === 0 ? (
            <span className="text-danger shrink-0 text-xs">
              발송 불가 — 수강 과목이 없어 학부모 보드를 찾을 수 없습니다
            </span>
          ) : t.subjects.length === 1 ? (
            <span className="text-text-dim shrink-0 text-xs">{boardLabel(t.studentId, t.subjects[0]!)}</span>
          ) : (
            <SearchableSelect
              className="w-48 shrink-0"
              value={pick[t.studentId] ?? ""}
              options={t.subjects.map((s) => ({ value: s, label: boardLabel(t.studentId, s) }))}
              onValueChange={(v) => onPick(t.studentId, v)}
              placeholder="알림장 선택"
              ariaLabel={`${t.name} 알림장 과목 선택`}
            />
          )}
          {/* 수학 반 보드 경로인데 받을 반 보드가 없는 학생 — 보내기 전에 알린다(보낸 뒤 '제외'로만 알면 늦다). */}
          {blockedOf(t.studentId, pick[t.studentId] ?? (t.subjects.length === 1 ? t.subjects[0] : undefined)) ? (
            <span className="text-danger w-full text-xs break-keep">
              발송 불가 —{" "}
              {NOTICE_SKIP_LABEL[blockedOf(t.studentId, pick[t.studentId] ?? (t.subjects.length === 1 ? t.subjects[0] : undefined))!]}
            </span>
          ) : null}
        </li>
      ))}
      {orphans.map((o) => (
        <li key={o.id} className="flex items-center gap-2 px-3 py-2 text-sm opacity-60">
          <span className="text-foreground w-20 shrink-0 truncate">{o.studentName ?? "이름 없음"}</span>
          <span className="text-text-faint min-w-0 flex-1 truncate text-xs">{o.bookName}</span>
          <span className="text-danger shrink-0 text-xs">발송 불가 — 학생 연결 없음</span>
        </li>
      ))}
    </ul>
  );
}
