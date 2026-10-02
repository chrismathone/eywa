/**
 * ClassNote 반 보드 **동기화 보고서**(0329a, 원장 2026-10-02) — 글 만들기·요약(순수, 서버·테스트 공용).
 *
 * 원장 *"반 동기화 하고 그럼 우측에 '동기화 보고서 다운로드'가 나와야겠어. 이 동기화 보고서에는 모든 변동된 리스트가 남아있고,
 * 변동실패한 리스트도 남아있고 모든 이유가 적혀있으면 될듯."*
 *
 * 재료 둘:
 *  · 동기화 회차(`classnote_board_sync_runs`) — 워커가 그 회차의 변동·실패·보류를 **한글 한 줄(이유 포함)** 로 적어 둔다
 *    (scripts/_classnote/class-board-sync-report.mjs). 여기서는 줄을 풀어 쓰지 않고 묶어 싣기만 한다.
 *  · 반 보드별 해제 확인 대상(`classnote_class_boards.release_names` — 자동 해제가 보류한 원아) — '지금 동기화'는 바뀐 반만 보므로 **전 반의 최신 목록**은 이쪽이다
 *    (classnote-release-list.ts).
 * ⚠️ 순수 모듈 — `server-only` 금지(#61).
 */
import { summarizeRelease, type ReleaseBoard } from "./classnote-release-list";

export type SyncRunGroup = "changed" | "failed" | "held" | "release";
export type SyncRunEvent = { group: SyncRunGroup; className: string; text: string };
/** 회차의 머리 — 줄 없이 숫자만(버튼 옆 요약은 이것만 읽는다: 상태를 물을 때마다 줄 2,000개를 내려받지 않게). */
export type SyncRunHead = {
  kind: "daily" | "request";
  finishedAt: string;
  ok: boolean;
  /** 멈춘 회차의 한글 사유(워커가 적는다). */
  error: string | null;
  /** 워커가 **전체 줄**에서 센 수(줄이 잘린 회차도 전체 기준). */
  counts: { changed: number; failed: number; held: number };
  /** 줄이 상한을 넘어 잘렸나(워커 `summary.truncated`). */
  truncated: boolean;
  /** 이 회차가 자동 해제를 했나(워커 `summary.autoRelease`) — 옛 워커·꺼짐·멈춤이면 false. 해제 확인 목록의 안내 문구를 고른다. */
  autoRelease: boolean;
  /** 연동 PC가 스스로 낸 요청의 회차인가(워커 `summary.auto`, 2026-10-03) — 사람이 누른 '지금 동기화'와 가려 적는다. */
  auto: boolean;
};
export type SyncRun = SyncRunHead & { events: SyncRunEvent[] };

const GROUPS: readonly SyncRunGroup[] = ["changed", "failed", "held", "release"];

/** jsonb 칸 → 줄 목록. 모르는 모양의 줄은 버린다(없는 사실을 지어내지 않는다). */
export function parseRunEvents(raw: unknown): SyncRunEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const o = item as Record<string, unknown>;
    const group = GROUPS.find((g) => g === o.group);
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (!group || !text) return [];
    return [{ group, className: typeof o.className === "string" ? o.className.trim() : "", text }];
  });
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

/** DB 행(줄 없이) → 회차 머리. 모르는 종류·끝난 시각 없는 행은 버린다. */
export function toSyncRunHead(row: Record<string, unknown> | null | undefined, events: SyncRunEvent[] = []): SyncRunHead | null {
  if (!row || (row.kind !== "daily" && row.kind !== "request") || typeof row.finished_at !== "string") return null;
  const summary = row.summary && typeof row.summary === "object" && !Array.isArray(row.summary) ? (row.summary as Record<string, unknown>) : {};
  const count = (group: SyncRunGroup) => num(summary[group]) ?? events.filter((e) => e.group === group).length;
  return {
    kind: row.kind,
    finishedAt: row.finished_at,
    ok: row.ok === true,
    error: typeof row.error === "string" && row.error.trim() ? row.error.trim() : null,
    counts: { changed: count("changed"), failed: count("failed"), held: count("held") },
    truncated: summary.truncated === true,
    autoRelease: summary.autoRelease === true,
    auto: summary.auto === true,
  };
}

/** DB 행(줄 포함) → 회차. */
export function toSyncRun(row: Record<string, unknown> | null | undefined): SyncRun | null {
  const events = parseRunEvents(row?.events);
  const head = toSyncRunHead(row, events);
  return head ? { ...head, events } : null;
}

/**
 * 버튼 옆 요약 — 가장 최근 회차의 변동·실패·보류 수 + **전 반**의 해제 대상 수.
 * 🔴 가장 최근 회차가 '지금 동기화'(바뀐 반만)면 **가장 최근 전체 동기화의 실패·멈춤도 함께** 든다 — 강사가 낮에 한 번 누른
 *    '바뀐 반 없음' 회차가 새벽 정기 동기화의 실패를 화면에서 지우면 안 된다(적대 리뷰 2026-10-02).
 */
export type SyncReportSummary = {
  finishedAt: string;
  ok: boolean;
  changed: number;
  failed: number;
  held: number;
  releaseNames: number;
  releaseClasses: number;
  /** 가장 최근 전체 동기화의 실패 줄 수·멈춤 — 가장 최근 회차가 전체 동기화면 0·false(위 숫자가 곧 그것이다). */
  dailyFailed: number;
  dailyStopped: boolean;
};

export function summarizeSyncReport(latest: SyncRunHead, boards: readonly ReleaseBoard[], lastDaily: SyncRunHead | null = null): SyncReportSummary {
  const release = summarizeRelease(boards);
  const daily = latest.kind === "request" ? lastDaily : null;
  return {
    finishedAt: latest.finishedAt,
    ok: latest.ok,
    changed: latest.counts.changed,
    failed: latest.counts.failed,
    held: latest.counts.held,
    releaseNames: release.names,
    releaseClasses: release.classes,
    dailyFailed: daily?.counts.failed ?? 0,
    dailyStopped: daily ? !daily.ok : false,
  };
}

/** 사람이 봐야 할 것의 수 — 실패·멈춤·해제 확인(가장 최근 전체 동기화의 실패·멈춤 포함). 버튼 숫자가 이것이다. */
export function reportAttention(s: SyncReportSummary): number {
  return s.failed + (s.ok ? 0 : 1) + s.releaseNames + s.dailyFailed + (s.dailyStopped ? 1 : 0);
}

const KST = "Asia/Seoul";
function kstParts(iso: string): { date: string; time: string } | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return {
    date: new Intl.DateTimeFormat("en-CA", { timeZone: KST }).format(d),
    time: new Intl.DateTimeFormat("ko-KR", { timeZone: KST, hour: "2-digit", minute: "2-digit", hour12: false }).format(d),
  };
}
const when = (iso: string) => {
  const p = kstParts(iso);
  return p ? `${p.date} ${p.time}` : "시각 모름";
};

/** 내려받을 파일 이름 — 동기화한 날(KST)과 시각. */
export function syncReportFilename(finishedAt: string): string {
  const p = kstParts(finishedAt);
  return `ClassNote-동기화보고서${p ? `-${p.date}-${p.time.replace(":", "")}` : ""}.txt`;
}

const EOL = "\r\n"; // 메모장에서 그대로 읽히게
const KIND_LABEL: Record<SyncRun["kind"], string> = {
  daily: "매일 정기 동기화(전체 반)",
  request: "지금 반 보드 동기화(바뀐 반만)",
};
const AUTO_LABEL = "자동 동기화(달라진 반만)";
const SECTION: Record<Exclude<SyncRunGroup, "release">, { title: string; note: string }> = {
  changed: { title: "변동된 것", note: "이번 동기화가 ClassNote에서 실제로 바꾼 것" },
  failed: { title: "변동 실패", note: "하려다 안 된 것과 이유" },
  held: { title: "보류", note: "확인이 안 돼 하지 않은 것과 이유" },
};

/** 한 묶음의 줄 — 반 이름순(반이 없는 줄이 먼저), 같은 반 안에서는 글자순. 머리의 건수는 워커가 센 전체 수. */
function sectionLines(run: SyncRun, group: Exclude<SyncRunGroup, "release">): string[] {
  const rows = run.events
    .filter((e) => e.group === group)
    .sort((a, b) => a.className.localeCompare(b.className, "ko") || a.text.localeCompare(b.text, "ko"));
  const head = `■ ${SECTION[group].title} (${run.counts[group]}건) — ${SECTION[group].note}`;
  if (!rows.length) return [head, "  없음"];
  return [head, ...rows.map((e) => `  ${e.className ? `[${e.className}] ` : ""}${e.text}`)];
}

function runBlock(run: SyncRun): string[] {
  const lines = [
    `동기화: ${when(run.finishedAt)} · ${run.kind === "request" && run.auto ? AUTO_LABEL : KIND_LABEL[run.kind]}`,
    `결과: ${run.ok ? "정상 완료" : `도중에 멈췄습니다 — ${run.error ?? "사유를 남기지 못했습니다"}`}`,
  ];
  if (!run.ok) {
    // 반별 줄을 남기기 전에 멈춘 회차(로그인·명단 조회 실패 등)는 아래 묶음이 비어 있다 — 있는 것처럼 안내하지 않는다.
    const detailed = run.events.some((e) => e.group === "failed" || e.group === "held");
    lines.push(
      detailed
        ? "  (멈추기 전에 이미 한 일은 아래 '변동된 것'에, 멈춘 자리와 못 한 반은 '변동 실패'·'보류'에 남아 있습니다.)"
        : "  (반별 작업을 시작하기 전에 멈춰 아래 묶음에 남은 줄이 없습니다 — 위 사유를 확인해 주세요.)",
    );
  }
  if (run.truncated) lines.push("  (줄이 너무 많아 일부만 실었습니다 — 전체는 연동 PC의 로그에 있습니다.)");
  for (const group of ["changed", "failed", "held"] as const) lines.push("", ...sectionLines(run, group));
  return lines;
}

/**
 * 전 반의 해제 확인 대상 — 반은 보드 이름순, 원아는 이름순. 확인한 날이 기준일과 다른 반은 그 날짜를 밝힌다.
 * `auto` = 가장 최근 동기화가 **자동 해제를 했는가**. 했다면 여기 남은 것은 워커가 일부러 보류한 원아라 "확인해 주세요"로 안내하고,
 * 안 했다면(옛 워커·꺼짐·멈춤) 수강이 끝난 원아도 그대로 남아 있으므로 예전처럼 "직접 해제해 주세요"로 안내한다.
 */
function releaseBlock(boards: readonly ReleaseBoard[], auto: boolean): string[] {
  const summary = summarizeRelease(boards);
  const what = auto ? "자동으로 해제하지 않은 원아" : "aywa 그 반 명단엔 없는 원아";
  const head = `■ 해제 확인이 필요한 원아 (${summary.names}명 · ${summary.classes}개 반) — ClassNote 반 보드엔 남아 있는데 ${what}(전 반 최신)`;
  const targets = boards.filter((b) => b.names.length).sort((a, b) => a.boardName.localeCompare(b.boardName, "ko"));
  if (!targets.length) return [head, "  없음"];
  const base = summary.checkedAt ? kstParts(summary.checkedAt) : null;
  const out = auto
    ? [
        head,
        // 🔴 수강이 끝난 것이 확인된 원아는 동기화가 **스스로 해제한다**(위 '변동된 것'의 '원아 해제' 줄). 여기 남은 것은 동기화가 **일부러 해제하지 않은**
        //    원아다 — 그 반에 지금 다니는 학생의 원아일 수 있거나 누구 원아인지 확인하지 못한 경우(이름 뒤에 사유). 그대로 해제하면 그 학생이
        //    반 보드 발송에서 빠진다. 그래서 "해제해 주세요"가 아니라 "확인해 주세요"로 안내한다.
        "  수강이 끝난 것이 확인된 원아는 동기화가 자동으로 해제합니다. 아래는 자동으로 해제하지 않은 원아입니다(이름 뒤 괄호가 그 이유).",
        "  ⚠️ 그 반에 지금 다니는 학생의 원아일 수 있습니다 — 그 반 학생이 아닌 것을 확인한 뒤에만",
        "     ClassNote 화면(기관설정 → 학생 관리 → 학생 → 소속 반 정보 → 삭제)에서 그 반만 해제해 주세요. 이름은 ClassNote에 등록된 원아 이름입니다.",
      ]
    : [
        head,
        "  ClassNote 화면(기관설정 → 학생 관리 → 학생 → 소속 반 정보 → 삭제)에서 그 반만 해제해 주세요. 이름은 ClassNote에 등록된 원아 이름입니다.",
        // 🔴 이 목록은 "aywa가 그 반 학생의 원아로 확인하지 못한 원아"다 — 반을 옮긴 학생이 대부분이지만, 지금 다니는 학생의 원아가
        //    섞일 수 있다(1인 보드가 없거나 이름이 달라 못 맞춘 경우). 그대로 해제하면 그 학생이 반 보드 발송에서 빠진다.
        "  ⚠️ 해제 전에 그 반에 지금 다니는 학생이 아닌지 꼭 확인해 주세요. aywa가 누구 원아인지 확인하지 못한 원아가 섞여 있을 수 있습니다",
        "     ('확인 필요'가 붙은 이름은 그 반 보류 학생과 이름이 비슷한 원아입니다 — 해제하면 그 학생이 반 보드에서 빠집니다).",
      ];
  for (const b of targets) {
    const at = kstParts(b.checkedAt);
    const stale = at && base && at.date !== base.date ? ` · 확인 ${at.date} ${at.time}` : "";
    const aywa = b.className && b.className.trim() !== b.boardName.trim() ? ` (aywa 반: ${b.className.trim()})` : "";
    out.push(`  [${b.boardName}]${aywa} ${b.names.length}명${stale}`);
    for (const name of [...b.names].sort((x, y) => x.localeCompare(y, "ko"))) out.push(`    - ${name}`);
  }
  return out;
}

/**
 * 동기화 보고서 글. 가장 최근 회차를 먼저 싣고, 그것이 '지금 동기화'(바뀐 반만)였다면 **가장 최근 전체 동기화**도 뒤에 붙인다 —
 * 바뀐 반만 본 회차에는 다른 반의 보류·실패가 없기 때문이다. 해제 대상은 회차와 무관하게 전 반의 최신 목록이다.
 */
export function buildSyncReportText(input: {
  latest: SyncRun;
  lastDaily: SyncRun | null;
  boards: readonly ReleaseBoard[];
  academyName?: string | null;
}): string {
  const { latest, boards } = input;
  const lastDaily = latest.kind === "request" ? input.lastDaily : null;
  const s = summarizeSyncReport(latest, boards, lastDaily);
  const lines: string[] = [
    `${input.academyName?.trim() ? `${input.academyName.trim()} ` : ""}ClassNote 반 보드 동기화 보고서`,
    `요약: 변동 ${s.changed}건 · 실패 ${s.failed}건 · 보류 ${s.held}건 · 해제 확인 ${s.releaseNames}명(${s.releaseClasses}개 반)`,
  ];
  // 바뀐 반만 본 회차가 맨 위일 때 — 전체 동기화의 실패·멈춤을 요약에서부터 밝힌다(아래 '참고'까지 내려가야 보이면 놓친다).
  if (lastDaily && (s.dailyFailed || s.dailyStopped))
    lines.push(`⚠️ 가장 최근 전체 동기화(${when(lastDaily.finishedAt)}): ${s.dailyStopped ? "도중에 멈춤 · " : ""}실패 ${s.dailyFailed}건 — 아래 '참고'를 함께 보세요`);
  // 해제 확인 목록의 안내는 **전 반을 본 회차**가 자동 해제를 했는지로 고른다(바뀐 반만 본 회차뿐이면 그 회차 값).
  const auto = lastDaily ? lastDaily.autoRelease : latest.autoRelease;
  lines.push("", ...runBlock(latest), "", ...releaseBlock(boards, auto));
  if (lastDaily) {
    lines.push("", "────────────────────────────────────────", "참고 — 가장 최근 전체 동기화(바뀐 반만 본 위 회차에는 다른 반의 실패·보류가 없습니다)", ...runBlock(lastDaily));
  }
  return lines.join(EOL) + EOL;
}
