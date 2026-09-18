import type { ReactNode } from "react";
import { leavePeriodLabel } from "@/features/leave/accrual";
import { formatSignedDays } from "@/features/leave/balance";
import { formatLeaveDays, isLeaveKind, LEAVE_KIND_LABEL } from "@/features/leave/request-days";
import { usedRangeLabel } from "@/features/leave/used-range";
import { docStatusLabel, type DocStatus } from "@/features/approvals/types";
import { sheetT } from "@/features/teacher-view/i18n";
import type { LeaveBalance } from "@/features/approvals/server/queries";
import type { MyLeaveHistory } from "@/features/leave/server/my-history";

/**
 * 내 연차 — **본인의** 부여·사용·잔여와 "언제 썼는지"(원장 2026-09-18: *"내정보에서 연차 남은 갯수
 * 연차 언제썼는지 기타등등 볼수있게해줘"*).
 *
 * 🔑 숫자는 `getMyLeaveBalance`(잔여 산식 단일 소스 balance.ts)가, 목록은 `getMyLeaveHistory`가 낸다 —
 *    이 파일은 **그리기만** 한다(여기서 한 번 더 더하면 카드 안에서 숫자와 목록이 어긋난다).
 * 🔑 라벨은 전부 단일 소스: 휴가 종류 `LEAVE_KIND_LABEL`(request-days) · 결재 상태 `docStatusLabel`
 *    (approvals/types) · 가감 표기 `formatSignedDays`(balance). 여기서 새 맵을 만들지 말 것.
 * 🔴 **조정의 사용일은 '사용'이 아니다** — 차감은 부여 쪽에서 이미 빠졌다(음수 조정). 목록에 나란히
 *    서더라도 위 '사용' 숫자에는 결재 문서만 들어간다(같은 연차를 두 번 세지 않는다, balance.ts 규약).
 * ⚠️ 못 읽은 것과 없는 것을 갈라 적는다 — "기록이 없다"고 단정하려면 실제로 읽었어야 한다([[#89]]).
 */

type Lang = Parameters<typeof sheetT>[0];
type SheetKey = Parameters<typeof sheetT>[1];

/** 목록 한 줄 — 휴가 문서와 조정을 **한 축(날짜)** 에 세운다. */
type Entry =
  | {
      kind: "doc";
      key: string;
      sortKey: string;
      label: string;
      kindLabel: string;
      days: number;
      status: DocStatus;
      docNo: string | null;
    }
  | {
      kind: "adj";
      key: string;
      sortKey: string;
      /** 실제 휴가 사용 기간(0270b). 없으면 적은 날을 대신 보여 준다. */
      usedStart: string | null;
      usedEnd: string | null;
      recordedAt: string;
      days: number;
      reason: string;
    };

export function LeaveCard({
  lang,
  balance,
  history,
}: {
  lang: Lang;
  balance: LeaveBalance;
  /** 구간이 없어 조회조차 못 했으면 null — 카드는 그 사실만 적는다. */
  history: MyLeaveHistory | null;
}) {
  const t = (key: SheetKey) => sheetT(lang, key);

  if (!balance.period) {
    return (
      <Shell lang={lang}>
        <p className="text-text-dim text-xs break-keep">{t("me.leave.noHire")}</p>
      </Shell>
    );
  }

  const entries: Entry[] = [
    ...(history?.docs ?? []).map<Entry>((d) => ({
      kind: "doc",
      key: `doc-${d.id}`,
      sortKey: d.startDate,
      label: d.startDate === d.endDate ? d.startDate : `${d.startDate} ~ ${d.endDate}`,
      // 모르는 종류면 라벨을 비운다 — 기본값('연차')으로 채우면 반차를 연차라고 말하게 된다.
      kindLabel: isLeaveKind(d.kind) ? LEAVE_KIND_LABEL[d.kind] : "",
      days: d.days,
      status: d.status as DocStatus,
      docNo: d.docNo,
    })),
    ...(history?.adjustments ?? []).map<Entry>((a) => ({
      kind: "adj",
      key: `adj-${a.id}`,
      // 사용 기간이 있으면 그 **시작일**로 줄을 세운다 — 이 목록의 축은 "언제의 일인가"다.
      sortKey: a.usedStart ?? a.createdAt.slice(0, 10),
      usedStart: a.usedStart,
      usedEnd: a.usedEnd,
      recordedAt: a.createdAt.slice(0, 10),
      days: a.days,
      reason: a.reason,
    })),
  ].sort((a, b) => b.sortKey.localeCompare(a.sortKey));

  return (
    <Shell lang={lang}>
      <p className="text-text-dim text-xs">
        <span className="num">{leavePeriodLabel(balance.period)}</span>
        <span className="ml-1.5">{balance.period.label}</span>
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t("me.leave.granted")} value={formatLeaveDays(balance.granted)} strong />
        <Stat label={t("me.leave.used")} value={formatLeaveDays(balance.used)} />
        <Stat label={t("me.leave.pending")} value={formatLeaveDays(balance.pending)} />
        <Stat label={t("me.leave.remaining")} value={formatLeaveDays(balance.remaining)} strong />
      </div>

      <p className="text-text-faint mt-2 text-xs break-keep">
        {t("me.leave.legal")} <span className="num">{formatLeaveDays(balance.period.granted)}</span>
        {balance.adjustment !== 0 ? (
          <>
            {" · "}
            {t("me.leave.adjust")} <span className="num">{formatSignedDays(balance.adjustment)}</span>
          </>
        ) : null}
        {" · "}
        {t("me.leave.desc")}
      </p>

      <div className="border-line mt-4 border-t pt-3">
        <p className="text-text-dim text-xs font-semibold">{t("me.leave.history")}</p>

        {history?.error ? (
          <p className="text-text-faint mt-1 text-xs" title={history.errorRaw}>
            {t("me.leave.loadFailed")}
          </p>
        ) : null}
        {history && !history.adjustmentsReady ? (
          <p className="text-text-faint mt-1 text-xs break-keep">{t("me.leave.adjustUnread")}</p>
        ) : null}
        {history?.adjustmentsReady && !history.usedRangeReady && history.adjustments.length > 0 ? (
          <p className="text-text-faint mt-1 text-xs break-keep">{t("me.leave.usedRangeNotReady")}</p>
        ) : null}
        {/* 조정이 한 줄이라도 있을 때만 — 없는 사람에게 설명만 띄우면 무슨 말인지 알 수 없다. */}
        {history?.adjustments.length ? (
          <p className="text-text-faint mt-1 text-xs break-keep">{t("me.leave.adjustNote")}</p>
        ) : null}

        {entries.length === 0 ? (
          <p className="text-text-faint mt-2 text-xs break-keep">
            {history ? t("me.leave.empty") : t("me.leave.loadFailed")}
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {entries.map((e) => (
              <li
                key={e.key}
                className="border-line/70 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border px-2.5 py-1.5 text-xs"
              >
                {e.kind === "doc" ? (
                  <>
                    <span className="min-w-0">
                      <span className="num text-foreground font-semibold">{e.label}</span>
                      {e.kindLabel ? <span className="text-text-dim ml-2">{e.kindLabel}</span> : null}
                      {e.docNo ? <span className="text-text-faint num ml-2">{e.docNo}</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="num text-foreground font-bold">{formatLeaveDays(e.days)}</span>
                      <span className="text-text-dim">{docStatusLabel(e.status).label}</span>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="min-w-0">
                      <span className="num text-foreground font-semibold">
                        {e.usedStart
                          ? usedRangeLabel(e.usedStart, e.usedEnd)
                          : `${t("me.leave.recordedOn")} ${e.recordedAt}`}
                      </span>
                      <span className="text-text-dim ml-2">{t("me.leave.adjustTag")}</span>
                      {e.reason ? (
                        <span className="text-text-faint ml-2 break-keep">{e.reason}</span>
                      ) : null}
                    </span>
                    <span className={`num shrink-0 font-bold ${e.days > 0 ? "text-green" : "text-danger"}`}>
                      {formatSignedDays(e.days)}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Shell>
  );
}

/** 카드 껍데기 — 같은 화면의 계정·보고서 이름 카드와 **같은 모양**(section + h2). */
function Shell({ lang, children }: { lang: Lang; children: ReactNode }) {
  return (
    <section className="border-line bg-card shadow-card rounded-2xl border p-5">
      <h2 className="text-foreground text-sm font-bold">{sheetT(lang, "me.leave.title")}</h2>
      <div className="mt-1">{children}</div>
    </section>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="border-line bg-bg-soft/40 rounded-lg border px-2.5 py-2">
      {/* 라벨은 공용 `micro`(작은 라벨 규약) — 임의 px 글자 크기는 가드가 막는다(control-scale). */}
      <p className="micro">{label}</p>
      <p
        className={`num mt-0.5 ${
          strong ? "text-foreground text-base font-bold" : "text-text-dim text-sm font-semibold"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
