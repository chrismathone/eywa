import { PageHeader } from "@/components/page-header";
import { BigStat } from "@/components/atoms/big-stat";

import { MenuGlyph } from "@/components/icons/menu-glyph";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { Toolbar, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { getNewcomers, NEWCOMER_WINDOW_DAYS } from "@/features/newcomers/server/queries";
import { BUCKET_LABEL, NEWCOMER_BUCKETS, type NewcomerBucket } from "@/features/newcomers/onboarding-items";
import { NewcomerTable } from "./_components/newcomer-table";

export const metadata = { title: "신규생 관리 — eywa" };

/**
 * 신규생 관리 — 원장 2026-09-09: *"신입 등록부터 3개월까지 7일, 30일, 60일, 90일 까지 관리하는거야.
 * 각종 지표를 바로 확인하게해서 신입생이 잘 관리되고 있는가 체크하게 하는것."*
 *
 * 화면은 **한 표**다 — 학생 한 줄 × 체크 7칸. 창(7·30·60·90일)은 위 칩으로 좁힌다.
 * 🔴 지표는 "얼마나 했나"가 아니라 **"놓친 게 있나"**를 먼저 말한다(지연 → 오늘·임박 → 대상 수 → 완료율).
 * ⚠️ 0251a 미적용이면 표는 그대로 뜨고 체크만 잠긴다([[#95]]) — 배너가 그 사실을 한글로 밝힌다.
 */
export default async function NewcomersPage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string }>;
}) {
  const viewer = await requireAccess("newcomers");
  const sp = await searchParams;
  const bucket = (NEWCOMER_BUCKETS as readonly string[]).includes(sp.bucket ?? "")
    ? (sp.bucket as NewcomerBucket)
    : null;

  const [view, canWrite] = await Promise.all([getNewcomers(), canWriteTenant(viewer.systemRole, "newcomers")]);
  // 창 필터는 화면 안에서만 좁힌다 — 지표(지연·임박)는 **전체 대상** 기준이라야 "지금 놓친 게 몇 건인지"가 흔들리지 않는다.
  const rows = bucket ? view.rows.filter((r) => r.bucket === bucket) : view.rows;
  const overdue = view.rows.reduce((n, r) => n + r.progress.overdue, 0);
  const dueSoon = view.rows.reduce((n, r) => n + r.progress.dueSoon, 0);
  const doneAll = view.rows.reduce((n, r) => n + r.progress.doneCount, 0);
  const dueAll = view.rows.reduce((n, r) => n + r.progress.dueTotal, 0);
  const rate = dueAll === 0 ? 100 : Math.round((doneAll / dueAll) * 100);
  const countOf = (b: NewcomerBucket) => view.rows.filter((r) => r.bucket === b).length;

  return (
    <div className="space-y-5 compact-chrome:space-y-3">
      <PageHeader
        eyebrow="재원 관리"
        title="신규생 관리"
        description={`등록 후 ${NEWCOMER_WINDOW_DAYS}일까지의 신입생을 체크리스트로 챙깁니다 · 기한은 등록일과 첫 수업일에서 자동으로 계산됩니다`}
      />

      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <BigStat
          label="지연"
          value={overdue}
          unit="건"
          tone="danger"
          valueClass={overdue > 0 ? "text-danger" : undefined}
          icon={<MenuGlyph name="alarm" size={22} />}
          sub="기한이 지난 미완료"
        />
        <BigStat label="오늘·임박" value={dueSoon} unit="건" tone="gold" icon={<MenuGlyph name="clock" size={22} />} sub="사흘 안" />
        <BigStat label="관리 대상" value={view.rows.length} unit="명" tone="primary" icon={<MenuGlyph name="users" size={22} />} sub={`최근 ${NEWCOMER_WINDOW_DAYS}일 등록`} />
        <BigStat
          label="완료율"
          value={rate}
          unit="%"
          tone="blue"
          icon={<MenuGlyph name="listChecks" size={22} />}
          sub={`기한이 온 ${dueAll}건 중 ${doneAll}건`}
        />
      </section>

      <Toolbar>
        <ToolbarSegment label="구간" wrap>
          <ToolbarSegmentItem active={bucket === null} href="/newcomers">
            전체 {view.rows.length}
          </ToolbarSegmentItem>
          {NEWCOMER_BUCKETS.filter((b) => b !== "over").map((b) => (
            <ToolbarSegmentItem key={b} active={bucket === b} href={`/newcomers?bucket=${b}`}>
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

      <NewcomerTable rows={rows} today={view.today} canWrite={canWrite && view.checksAvailable} />
    </div>
  );
}
