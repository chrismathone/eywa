import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { Toolbar, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { getNewcomers, NEWCOMER_WINDOW_DAYS } from "@/features/newcomers/server/queries";
import {
  BUCKET_LABEL,
  NEWCOMER_BUCKETS,
  ONBOARDING_ITEMS,
  statusOf,
  type NewcomerAnchors,
  type NewcomerBucket,
} from "@/features/newcomers/onboarding-items";
import { careCellMatches, parseCareCellParam } from "@/features/newcomers/care-cells";
import { NewcomerTable } from "./_components/newcomer-table";

export const metadata = { title: "신규생 관리 — eywa" };

/** 미완료만 보기 — 지연·오늘·임박이 하나라도 있는 학생. */
const OPEN_ONLY = "open";

/**
 * 신규생 관리 — 원장 2026-09-09: *"신입 등록부터 3개월까지 7일, 30일, 60일, 90일 까지 관리하는거야.
 * 각종 지표를 바로 확인하게해서 신입생이 잘 관리되고 있는가 체크하게 하는것."*
 *
 * 화면은 **한 표**다 — 학생 한 줄 × 체크 7칸. 창(7·30·60·90일)은 위 칩으로 좁힌다.
 * 🔴 지표는 "얼마나 했나"가 아니라 **"놓친 게 있나"**를 먼저 말한다(지연 → 오늘·임박 → 대상 수 → 완료율).
 * 🔴 지표는 **큰 카드가 아니라 인라인 한 줄**이다(원장 2026-09-09: *"카드로 표시되고 있는거 너무 거창하게
 *    하지말고, 시간표처럼 간단하게 공간차지 덜했으면"*) — 시간표 학생 집계와 같은 문법이고, 여기서는
 *    **눌러서 거르는** 칩이라 "지연 134건"을 보고 곧바로 그 명단으로 갈 수 있다(원장 *"미완료건을 확인할
 *    방법이 없음"*).
 * ⚠️ 0251a 미적용이면 표는 그대로 뜨고 체크만 잠긴다([[#95]]) — 배너가 그 사실을 한글로 밝힌다.
 */
export default async function NewcomersPage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string; only?: string; item?: string }>;
}) {
  const viewer = await requireAccess("newcomers");
  const sp = await searchParams;
  const bucket = (NEWCOMER_BUCKETS as readonly string[]).includes(sp.bucket ?? "")
    ? (sp.bucket as NewcomerBucket)
    : null;
  const openOnly = sp.only === OPEN_ONLY;
  /**
   * `?item=` — 운영실 '신규생 케어' 칸에서 넘어온 필터.
   * 🔴 **숫자를 센 조건과 정확히 같은 함수**(`careCellMatches`)로 거른다 — 두 곳이 각자 계산하면
   *    "12건이라더니 목록엔 9명"이 된다. 모르는 값이면 아무것도 안 거른다(빈 목록보다 전체가 낫다).
   */
  const itemCell = parseCareCellParam(sp.item);

  const [view, canWrite] = await Promise.all([getNewcomers(), canWriteTenant(viewer.systemRole, "newcomers")]);
  // 창 필터는 화면 안에서만 좁힌다 — 지표(지연·임박)는 **전체 대상** 기준이라야 "지금 놓친 게 몇 건인지"가 흔들리지 않는다.
  const openOf = (r: (typeof view.rows)[number]) => r.progress.overdue + r.progress.dueSoon > 0;
  const rows = view.rows
    .filter((r) => (bucket ? r.bucket === bucket : true))
    .filter((r) => (openOnly ? openOf(r) : true))
    .filter((r) => (itemCell ? careCellMatches(itemCell, r, view.today) : true));
  const overdue = view.rows.reduce((n, r) => n + r.progress.overdue, 0);
  const dueSoon = view.rows.reduce((n, r) => n + r.progress.dueSoon, 0);
  const doneAll = view.rows.reduce((n, r) => n + r.progress.doneCount, 0);
  const dueAll = view.rows.reduce((n, r) => n + r.progress.dueTotal, 0);
  const rate = dueAll === 0 ? 100 : Math.round((doneAll / dueAll) * 100);
  const openCount = view.rows.filter(openOf).length;
  const countOf = (b: NewcomerBucket) => view.rows.filter((r) => r.bucket === b).length;
  const hrefWith = (next: { bucket?: NewcomerBucket | null; only?: boolean; item?: string | null }) => {
    const b = next.bucket === undefined ? bucket : next.bucket;
    const o = next.only === undefined ? openOnly : next.only;
    const i = next.item === undefined ? (itemCell?.key ?? null) : next.item;
    const qs = [b ? `bucket=${b}` : null, o ? `only=${OPEN_ONLY}` : null, i ? `item=${i}` : null]
      .filter(Boolean)
      .join("&");
    return qs ? `/newcomers?${qs}` : "/newcomers";
  };
  /**
   * 🔴 위 넷은 전부 **체크 기록**에서 나온다 — 조회가 실패했으면 숫자를 지어내지 않고 `—`로 둔다
   *    (실제 0과 구분되게). ⚠️ 표가 아직 없는 것(0251a 미적용)은 실패가 아니라 "아직 안 켜짐"이라
   *    그대로 센다 — 그땐 체크가 0건인 것이 사실이고, 배너가 저장이 잠긴 사실을 따로 말한다.
   */
  const counted = view.checksError === null;
  const stat = (n: number) => (counted ? n : "—");
  const unknownTitle = "체크 기록을 불러오지 못해 셀 수 없습니다";
  // 🔴 "기한이 온 건"은 아직 아무도 안 끝낸 상태에서도 **왜 그런지**를 말해야 한다 — 기능 시작일
  //    이전 기한은 세지 않으므로(`waived`) 분모가 작다. 그 사실을 한 줄로 남긴다.
  const waived = view.rows.reduce((n, r) => {
    const anchors: NewcomerAnchors = { enrolledOn: r.enrolledOn, firstClassOn: r.firstClassOn };
    return (
      n +
      ONBOARDING_ITEMS.filter(
        (item) => !item.optional && statusOf(item, anchors, r.checks[item.key], view.today) === "waived",
      ).length
    );
  }, 0);

  return (
    <div className="space-y-4 compact-chrome:space-y-3">
      {/* 설명 줄은 뺐다(원장 2026-09-09 *"'등록 후 ~ 됩니다' 제거해 필요없어. 공간낭비"*) —
          기한이 어떻게 계산되는지는 각 칸의 툴팁이 그 자리에서 말한다. */}
      <PageHeader eyebrow="재원 관리" title="신규생 관리" />

      <Toolbar>
        {/* 지표 = 인라인 칩. 지연·오늘·임박은 **눌러서 그 명단으로** 좁힌다. */}
        <ToolbarSegment label="현황" wrap>
          <ToolbarSegmentItem active={openOnly} href={hrefWith({ only: !openOnly })}>
            미완료 {stat(openCount)}명
          </ToolbarSegmentItem>
          {/* 🔴 걸린 필터는 반드시 보이고 해제할 수 있어야 한다 — 운영실에서 링크로 들어오면
              화면엔 "왜 명단이 짧은지"를 말해 주는 것이 이 칩뿐이다. */}
          {itemCell ? (
            <ToolbarSegmentItem active href={hrefWith({ item: null })}>
              {itemCell.label} {rows.length}명 · 해제
            </ToolbarSegmentItem>
          ) : null}
        </ToolbarSegment>
        <span className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 whitespace-nowrap">
          <span className="text-sm" title={counted ? undefined : unknownTitle}>
            <b className={`num text-lg font-bold ${counted && overdue > 0 ? "text-danger" : "text-text-faint"}`}>
              {stat(overdue)}
            </b>{" "}
            <span className="text-text-dim">지연</span>
          </span>
          <span className="text-sm" title={counted ? undefined : unknownTitle}>
            <b className={`num text-lg font-bold ${counted && dueSoon > 0 ? "text-amber" : "text-text-faint"}`}>
              {stat(dueSoon)}
            </b>{" "}
            <span className="text-text-dim">오늘·임박</span>
          </span>
          {/* 🔴 '대상'은 체크가 아니라 **학생 명단**에서 나온다 — 체크 조회가 실패해도 이 수는 사실이다. */}
          <span className="text-sm">
            <b className="num text-primary text-lg font-bold">{view.rows.length}</b>{" "}
            <span className="text-text-dim">대상</span>
          </span>
          <span className="text-sm" title={counted ? `기한이 온 ${dueAll}건 중 ${doneAll}건 완료` : unknownTitle}>
            <b className={`num text-lg font-bold ${counted ? "text-green" : "text-text-faint"}`}>{stat(rate)}</b>{" "}
            <span className="text-text-dim">% 완료</span>
          </span>
          {counted && waived > 0 ? (
            <span
              className="text-text-faint text-xs"
              title="이 기능이 생기기 전에 기한이 지난 항목입니다 — 기록할 방법이 없었으므로 지연으로 세지 않습니다"
            >
              (기준일 이전 <span className="num">{waived}</span>건 제외)
            </span>
          ) : null}
        </span>
        <div className="rail-spacer ml-auto" aria-hidden />
        <ToolbarSegment label="구간" wrap>
          <ToolbarSegmentItem active={bucket === null} href={hrefWith({ bucket: null })}>
            전체 {view.rows.length}
          </ToolbarSegmentItem>
          {NEWCOMER_BUCKETS.filter((b) => b !== "over").map((b) => (
            <ToolbarSegmentItem key={b} active={bucket === b} href={hrefWith({ bucket: b })}>
              {BUCKET_LABEL[b]} {countOf(b)}
            </ToolbarSegmentItem>
          ))}
        </ToolbarSegment>
      </Toolbar>

      {!view.checksAvailable ? (
        <p className="bg-amber-soft text-amber rounded-md px-3 py-2 text-sm break-keep" title={view.checksError?.raw}>
          {view.checksError
            ? view.checksError.summary
            : "체크 기록 표가 아직 만들어지지 않았습니다 — 목록은 그대로 보이지만 체크는 저장되지 않습니다(0251a 적용 필요)."}
        </p>
      ) : null}

      {/* ⚠️ 구간 필터가 함께 걸려 있으면 "모두 챙겼다"고 말하지 않는다 — 그 구간만 깨끗한 것이지
          전체가 깨끗한 게 아니다(빈 화면이 사실보다 좋게 말하면 안 된다). */}
      {itemCell && rows.length === 0 ? (
        <p className="text-text-faint border-line rounded-lg border border-dashed px-4 py-8 text-center text-sm">
          {itemCell.label} 항목에 지금 챙길 학생이 없습니다.
        </p>
      ) : openOnly && rows.length === 0 ? (
        <p className="text-text-faint border-line rounded-lg border border-dashed px-4 py-8 text-center text-sm">
          {bucket
            ? `${BUCKET_LABEL[bucket]} 구간에는 지연·임박한 항목이 없습니다.`
            : `지연·임박한 항목이 없습니다 — 최근 ${NEWCOMER_WINDOW_DAYS}일 신규생을 모두 챙겼습니다.`}
        </p>
      ) : (
        <NewcomerTable rows={rows} today={view.today} canWrite={canWrite && view.checksAvailable} />
      )}
    </div>
  );
}
