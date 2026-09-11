/**
 * 성적관리 JJ실 화면 공용 조각 — 실패 배너 · 기간 줄 · KST 시각 표기 · 스켈레톤.
 *
 * 🔴 실패 문구는 원인을 단정하지 않는다(설정 없음 ≠ 서버 꺼짐 ≠ 열쇠 틀림) — 종류별 한글 한 줄이 contract.ts에
 *    있고, HTTP·원문은 title 툴팁으로만 보인다(UI raw 노출 금지).
 */
import type { JjRange } from "@/features/ijw/range";

/** 강사 스코프 계산이 실패해 좁게 떨어졌을 때 — 빈 표를 "담당 학생 없음"으로 읽지 않게. */
export const JJ_SCOPE_FAILED = "담당 학생 목록을 불러오지 못했습니다. 잠시 후 다시 열어 주세요.";

export function JjFailBanner({ message, detail }: { message: string; detail?: string }) {
  return (
    <p
      className="border-amber/40 bg-amber-soft text-amber rounded-2xl border px-4 py-3 text-sm font-medium"
      title={detail}
    >
      {message}
    </p>
  );
}

/**
 * 짝 칸(0259a) 적용 전 안내. 관리자는 인재원 이름으로 계속 보고, 강사는 담당 학생을 가려낼 수 없어 비워 둔다
 * (빈 표 위에 "인재원 이름으로 보여 줍니다"라고 적으면 거짓말이 된다, 적대 리뷰 2026-09-10).
 */
export function JjLinkColumnNotice({ teacher = false }: { teacher?: boolean }) {
  return (
    <p className="border-line bg-bg-soft/60 text-text-dim rounded-2xl border px-4 py-2.5 text-xs">
      {teacher
        ? "학생 짝 칸이 아직 준비되지 않아(DB 적용 전) 담당 학생을 가려낼 수 없습니다 — 적용되면 담당 학생의 기록이 보입니다."
        : "학생 짝 칸이 아직 준비되지 않았습니다(DB 적용 전). eywa 학생과 연결하지 않고 인재원 이름으로만 보여 줍니다."}
    </p>
  );
}

/** 표 위 한 줄 안내(주의 아님) — 반 정보 실패·모르는 반 등. 원문은 title 툴팁으로만. */
export function JjNote({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <p className="border-line bg-bg-soft/60 text-text-dim rounded-2xl border px-4 py-2.5 text-xs" title={title}>
      {children}
    </p>
  );
}

export function JjSkeleton() {
  return <div className="bg-card shadow-card h-64 animate-pulse rounded-2xl" />;
}

/** ISO 시각 → KST "9월 1일 14:32". 못 읽으면 "—". */
export function kstDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export type PeriodNote = { text: string; warn: boolean };

/**
 * 기간 줄의 덧말 — 고친 기간(주의)·기본 기간(안내). 날짜 칸은 기본값을 값으로 채우지 않는다.
 * 🔴 **실제로 옮긴 쪽**을 적는다(적대 재리뷰 2026-09-10: 시작이 뒤로 밀렸는데 "시작일을 당겼습니다"라고 적었다).
 */
export function rangeNote(range: JjRange, defaultLabel: string): PeriodNote | undefined {
  const moved = [
    range.startFuture ? "시작일이 앞으로의 날짜라 최근 기간으로 바꿨습니다" : "",
    range.swapped ? "시작일이 끝날보다 뒤라 맞바꿨습니다" : "",
    range.endCapped ? "앞으로의 날짜엔 기록이 없어 끝날을 오늘로 바꿨습니다" : "",
    range.clamped ? "최대 1년까지만 볼 수 있어 최근 1년으로 줄였습니다" : "",
  ].filter(Boolean);
  if (moved.length) return { text: moved.join(" · "), warn: true };
  return range.isDefault ? { text: defaultLabel, warn: false } : undefined;
}

/** 기간 줄 — 날짜 기준을 **같이** 적는다(시험 = 달력 날짜, 학습 = 새벽 3시 경계. 섞으면 하루가 밀린다). */
export function JjPeriodLine({
  from,
  to,
  basis,
  extra,
  note,
}: {
  from: string;
  to: string;
  basis: "exam" | "study";
  extra?: string;
  note?: PeriodNote;
}) {
  return (
    <p className="micro">
      기간 <span className="text-foreground num font-bold">{from}</span> ~{" "}
      <span className="text-foreground num font-bold">{to}</span>
      {note ? (
        <span className={`ml-2 normal-case ${note.warn ? "text-amber font-bold" : "text-text-faint"}`}>· {note.text}</span>
      ) : null}
      <span className="text-text-faint ml-2 normal-case">
        {basis === "study" ? "· 학습일 기준(새벽 3시에 날이 바뀝니다)" : "· 제출한 날짜 기준"}
      </span>
      {extra ? <span className="text-text-faint ml-2 normal-case">· {extra}</span> : null}
    </p>
  );
}
