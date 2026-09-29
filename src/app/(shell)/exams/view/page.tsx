import { SearchX } from "@/components/icons/aywa-icon-compat";
import { EmptyState } from "@/components/empty-state";
import { FilterSelect } from "@/components/filter-select";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { HrefSelect, type HrefSelectOption } from "@/components/href-select";
import { PageHeader } from "@/components/page-header";
import { Toolbar } from "@/components/toolbar";
import { requireAccess } from "@/lib/auth/require-access";
import { kstToday } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getGradeOverview } from "@/features/grades/server/overview-queries";
import { TERM_OPTIONS, defaultTermOf, normalizeTerm, normalizeYear, termLabel, termYearOptions } from "@/features/grades/term";
import { GradeViewSwitch } from "../_components/view-switch";
import { OverviewTable } from "./_components/overview-table";

export const metadata = { title: "성적 확인 — 에이와" };

/**
 * 성적 **확인 뷰** — 원장 2026-09-23: *"이 창은 기입창이고 확인하는 뷰페이지를 추가로 만들어야할듯"*.
 *
 * 입력 격자(`/exams`)는 시험 **한 칸**을 세로로 쭉 적는 화면이고, 여기는 그 학기의 **모든 시험을
 * 가로로** 놓고 눈으로 훑는 화면이다. 그래서 읽기 전용이고 입력 요소가 하나도 없다.
 * 🔑 과목은 **합쳐서 본다** — 영어의 EiE/인재원은 입력할 반을 고르는 축이라 여기선 안 나눈다
 *    (원장 2026-09-22: *"전체데이터 볼 때는 영어 하나로"*).
 * ⚠️ 권한은 메뉴 게이트 하나(`exams`) — 읽기 전용이라 쓰기 게이트가 없다.
 */
export default async function ExamsViewPage({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string;
    term?: string;
    subject?: string;
    class?: string;
    embed?: string;
  }>;
}) {
  await requireAccess("exams");
  const sp = await searchParams;
  const one = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const isEmbed = one(sp.embed) === "1";

  const settings = await getTenantSettings();
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const subjectKeys = subjects.options.map((o) => o.value);
  if (subjectKeys.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="학생 관리" title="성적 확인" description="학기별 성적을 한눈에 봅니다" />
        <EmptyState
          compact
          image="exams"
          icon={() => <SearchX size={32} strokeWidth={1.8} />}
          title="학원 설정에 과목이 없습니다"
          description="학원 설정 → 운영에서 과목을 먼저 등록해주세요."
        />
      </div>
    );
  }

  const today = defaultTermOf(kstToday());
  const year = normalizeYear(one(sp.year), today.year);
  const term = normalizeTerm(one(sp.term), today.term);
  const subjectRaw = one(sp.subject);
  const subject = subjectKeys.includes(subjectRaw) ? subjectRaw : subjectKeys[0]!;
  const classRaw = one(sp.class);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const classId = UUID.test(classRaw) ? classRaw : null;

  const overview = await getGradeOverview({ year, term, subject, classId });

  const buildHref = (patch: Partial<Record<string, string>>) => {
    const cur: Record<string, string> = {
      year: String(year),
      term: String(term),
      subject,
      class: classId ?? "",
      ...patch,
    };
    // 과목을 바꾸면 반이 통째로 달라진다 — 옛 반이 따라가면 빈 표가 된다(입력 격자와 같은 규약).
    if (patch.subject !== undefined && patch.subject !== subject) cur.class = "";
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(cur)) if (v) params.set(k, v);
    if (isEmbed) params.set("embed", "1");
    const s = params.toString();
    return s ? `/exams/view?${s}` : "/exams/view";
  };

  const yearOptions: HrefSelectOption[] = termYearOptions(kstToday()).map((y) => ({
    value: String(y),
    label: `${y}년`,
    href: buildHref({ year: String(y) }),
  }));
  const termOptions: HrefSelectOption[] = TERM_OPTIONS.map((t) => ({ ...t, href: buildHref({ term: t.value }) }));
  const subjectSelectOptions: HrefSelectOption[] = subjects.options.map((o) => ({
    value: o.value,
    label: o.label,
    href: buildHref({ subject: o.value }),
  }));

  return (
    <div className="flex h-full min-h-0 flex-col space-y-5">
      <PageHeader
        eyebrow="학생 관리"
        title="성적 확인"
        description={`${termLabel(year, term)} · ${subjects.labelOf(subject)} · 시험 ${overview.columns.length}칸`}
        embedLabel={`${termLabel(year, term)} · ${subjects.labelOf(subject)}`}
      />

      <Toolbar>
        <GradeViewSwitch
          active="view"
          inputHref={`/exams/input?year=${year}&term=${term}&subject=${subject}${isEmbed ? "&embed=1" : ""}`}
          viewHref={buildHref({})}
          unifiedHref={isEmbed ? "/exams?embed=1" : "/exams"}
        />
        <HrefSelect axisLabel="년도" ariaLabel="년도 선택" value={String(year)} options={yearOptions} />
        <HrefSelect axisLabel="학기" ariaLabel="학기 선택" value={String(term)} options={termOptions} />
        <HrefSelect axisLabel="과목" ariaLabel="과목 선택" value={subject} options={subjectSelectOptions} />
        <FilterSelect
          paramName="class"
          axisLabel="반"
          ariaLabel="반 선택"
          value={classId ?? ""}
          options={overview.classes.map((c) => ({ value: c.id, label: c.className }))}
          cap={300}
          triggerClassName={TOOLBAR_SELECT}
        />
      </Toolbar>

      {!overview.schemaReady ? (
        <p className="border-amber/40 bg-amber-soft text-foreground rounded-lg border px-3 py-2 text-sm">
          성적 표 준비(0283a)가 아직 적용되지 않아 점수를 읽지 못했습니다 — 적용 뒤에 표가 채워집니다.
        </p>
      ) : null}

      {overview.schemaReady && overview.rows.length > 0 && overview.columns.length === 0 ? (
        <p className="border-line bg-bg-soft text-text-dim rounded-lg border px-3 py-2 text-sm">
          이 학기·과목에 아직 적힌 성적이 없습니다 — [입력]에서 시험을 고르고 점수를 적으면 여기에 열이 섭니다.
        </p>
      ) : null}

      {overview.rows.length > 0 ? (
        <OverviewTable columns={overview.columns} rows={overview.rows} />
      ) : (
        <EmptyState
          compact
          image="exams"
          icon={() => <SearchX size={32} strokeWidth={1.8} />}
          title="이 학기 명단이 없습니다"
          description="년도·학기·과목을 바꿔보세요. 강사 계정은 담당(담임·부담임) 반만 보입니다."
        />
      )}
    </div>
  );
}
