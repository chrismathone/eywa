import { Suspense } from "react";
import { SearchX } from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { EmbedAnchor, EmbedHiddenInput } from "@/components/embed-link";
import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/atoms/pill";
import { EyIcon } from "@/components/icons/aywa-icons";
import {
  TOOLBAR_SEARCH_BOX,
  TOOLBAR_SEG_BOX,
  TOOLBAR_SEG_BOX_WRAP,
  TOOLBAR_SEG_ITEM,
  TOOLBAR_SEG_OFF,
  TOOLBAR_SEG_ON_PRIMARY,
} from "@/components/toolbar-controls";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { requireAccess } from "@/lib/auth/require-access";
import { Pagination } from "@/components/pagination";
import { kstToday } from "@/lib/date-kst";
import { JJ_STUDY_MAX_DAYS, ijwStudyDay, resolveJjRange, type JjRange } from "@/features/ijw/range";
import { getExamsPage, type ExamRow } from "@/features/exams/server/queries";
import { getClassesList } from "@/features/classes/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps, type SubjectMaps } from "@/features/owner/subjects";
import { ijwConfigFor } from "@/features/ijw/server/client";
import { getJjViewer } from "@/features/ijw/server/queries";
import { CreateExamTrigger, type ExamClassOption } from "./_components/exam-form-dialog";
import { JjExamView } from "./_components/jj-exam-view";
import { JjLinkSection } from "./_components/jj-link-section";
import { JjSkeleton } from "./_components/jj-shared";
import { JjStudyView } from "./_components/jj-study-view";

export const metadata = { title: "성적관리 — aywa" };

const PAGE_SIZE = 50;

const TYPE_LABEL: Record<string, string> = { weekly: "주간", mock: "모의", school: "학교" };
const TYPE_FILTERS = [
  { value: "all", label: "전체" },
  { value: "weekly", label: "주간" },
  { value: "mock", label: "모의" },
  { value: "school", label: "학교" },
];

/**
 * 영어 전용 보기 2개(사용자 2026-09-10) — 인재원 학습 프로그램(MemoType)의 **JJ실 학습**과 **단어시험**.
 * 기존 시험 표(exams·student_grades)와 데이터가 다르다: aywa에 저장하지 않고 매번 인재원에 묻는다(pull).
 * 그래서 '유형' 칩에 나란히 두되 **영어일 때만** 보이고, 고르면 표 대신 JJ 화면을 그린다.
 * ⚠️ 연동이 설정된 학원(IJW_TENANT_ID)에서만 칩이 뜬다 — 다른 학원엔 "설정 안 됨"만 뜨는 빈 칩이 생기지 않게.
 * ⚠️ 강사는 담당(세 갈래 — 담임·교시 담당·위임) 반에 영어가 있을 때만(viewer.hasEnglish) — 수학만 맡은 강사에게
 *    학원 전체 영어 시험 집계가 새지 않게(적대 리뷰 2026-09-10).
 * ⚠️ `english`는 과목 **표준 키**(코드 특수동작 허용 범위) — 과목 라벨·색은 계속 학원설정에서 읽는다.
 */
const JJ_TYPES = [
  { value: "jj", label: "JJ실" },
  { value: "jj_exam", label: "JJ실(시험)" },
] as const;
const isJjType = (t: string) => t === "jj" || t === "jj_exam";

export default async function ExamsPage({
  searchParams,
}: {
  searchParams: Promise<{
    subject?: string;
    page?: string;
    q?: string;
    type?: string;
    from?: string;
    to?: string;
    jjClass?: string;
    embed?: string;
  }>;
}) {
  const user = await requireAccess("exams");
  const sp = await searchParams;
  // 같은 이름의 주소 값이 두 번 오면 배열이 된다 — 문자열일 때만 읽는다(`.trim()` TypeError·배열 필터 400으로 화면이
  // 죽지 않게, 적대 리뷰 2026-09-11).
  const one = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const subject = one(sp.subject) || "all";
  const rawType = one(sp.type) || "all";
  const jjEnabled = !!ijwConfigFor(user.tenantId);
  // JJ 보기는 영어·연동 학원일 때만 — 과목을 바꾸면 '전체'로 돌아간다(주소에 남은 type=jj가 빈 표를 만들지 않게).
  const wantsJj = jjEnabled && subject === "english" && isJjType(rawType);
  const examType = isJjType(rawType) ? "all" : rawType;
  const q = one(sp.q);
  const from = one(sp.from);
  const to = one(sp.to);
  // JJ 반 칩(aywa 영어 반 id, 2026-09-11) — JJ 보기에서만 쓴다. 담당 밖·모르는 반이면 보기 쪽이 무시하고 그 사실을 적는다.
  const jjClass = one(sp.jjClass);
  const page = Math.max(1, Number(sp.page) || 1);
  // 플로팅 창(iframe) 안이면 주소 빌더가 embed=1을 싣는다(페이지·JJ 반 칩 — 학원 설정 감사로그 면과 같은 규칙).
  // ⚠️ 하드 이동(칩·초기화·검색 폼)은 이 값에 기대지 않는다 — embed 없이 소프트 이동으로 들어온 첫 렌더에선 이 값이
  //    거짓이라, 그쪽은 `EmbedAnchor`·`EmbedHiddenInput`이 클라에서 판정한다(전수검사 2026-09-11).
  const isEmbed = one(sp.embed) === "1";

  const loadRegular = () =>
    Promise.all([
      getExamsPage(
        {
          subject: subject === "all" ? undefined : subject,
          examType: examType === "all" ? undefined : examType,
          q: q || undefined,
          from: from || undefined,
          to: to || undefined,
        },
        page,
        PAGE_SIZE,
      ),
      getClassesList({ active: "active" }),
    ] as const);
  // JJ 칩을 세울지는 **보는 사람**이 정한다(viewer.hasEnglish) — 영어 과목을 볼 때만 계산한다.
  const [viewer, settings, regularFirst] = await Promise.all([
    jjEnabled && subject === "english" ? getJjViewer() : Promise.resolve(null),
    getTenantSettings(),
    wantsJj ? Promise.resolve(null) : loadRegular(),
  ]);
  const jjAvailable = !!viewer?.hasEnglish;
  const jjMode = wantsJj && jjAvailable ? (rawType as "jj" | "jj_exam") : null;
  // 드묾: 주소는 JJ인데 이 사람에게 JJ가 없으면(수학만 맡은 강사) 그때 일반 목록을 읽는다.
  const regular = jjMode ? null : (regularFirst ?? (await loadRegular()));
  const rows = regular?.[0].rows ?? [];
  const total = regular?.[0].total ?? 0;
  const classList = regular?.[1] ?? [];
  // JJ 기간 — 형식·순서·상한을 인재원이 받는 모양으로(range.ts). 학습 = 학습일(03:00 경계), 시험 = KST 달력 날짜.
  // 기본은 학습 최근 7일(인재원 설명서: 반 묶음이 가장 가볍다), 시험 최근 30일.
  const jjRange: JjRange | null =
    jjMode === "jj"
      ? resolveJjRange({ from, to }, { today: ijwStudyDay(), defaultDays: 7, maxDays: JJ_STUDY_MAX_DAYS })
      : jjMode === "jj_exam"
        ? resolveJjRange({ from, to }, { today: kstToday(), defaultDays: 30 })
        : null;
  // 과목 라벨·색·필터 칩은 학원설정(operations.subjects) 단일 소스 — 미등록 과목은 칩에 안 뜸.
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const classOptions: ExamClassOption[] = classList.map((c) => ({
    id: c.id,
    className: c.className,
    subject: c.subject,
  }));
  const activeType = jjMode ?? examType;
  const typeFilters = jjAvailable ? [...TYPE_FILTERS, ...JJ_TYPES] : TYPE_FILTERS;

  // 필터/검색 href — 칩·검색은 page 리셋(page 미세팅).
  const buildHref = (
    patch: Partial<{ subject: string; type: string; q: string; from: string; to: string; jjClass: string }>,
  ) => {
    const cur = { subject, type: activeType, q, from, to, jjClass: jjMode ? jjClass : "", ...patch };
    // 영어가 아니면 JJ 보기가 없다 — 과목 칩을 누르면 유형을 '전체'로 되돌린다.
    if (cur.subject !== "english" && isJjType(cur.type)) cur.type = "all";
    // 반 칩은 JJ 보기 전용 — 일반 목록으로 가면 버린다(주소에 남아 다음 JJ 진입을 몰래 좁히지 않게).
    if (!isJjType(cur.type)) cur.jjClass = "";
    // 🔴 JJ ↔ 일반 목록을 오갈 땐 기간을 버린다 — 날짜 기준이 다르고(학습일·제출일 ↔ 시험일), JJ에서 누른 '검색'의
    //    기간이 일반 목록을 조용히 좁혀 "등록된 시험이 없습니다"가 떴다(적대 리뷰 2026-09-10). 반대 방향도 같다.
    if (isJjType(activeType) !== isJjType(cur.type)) {
      cur.from = "";
      cur.to = "";
    }
    const params = new URLSearchParams();
    if (cur.subject !== "all") params.set("subject", cur.subject);
    if (cur.type !== "all") params.set("type", cur.type);
    if (cur.q) params.set("q", cur.q);
    if (cur.from) params.set("from", cur.from);
    if (cur.to) params.set("to", cur.to);
    if (cur.jjClass) params.set("jjClass", cur.jjClass);
    if (isEmbed) params.set("embed", "1");
    const s = params.toString();
    return s ? `/exams?${s}` : "/exams";
  };
  const pageHref = (p: number) => {
    const base = buildHref({});
    if (p <= 1) return base;
    return base === "/exams" ? `/exams?page=${p}` : `${base}&page=${p}`;
  };

  return (
    <div className="space-y-5">
      {/* Editorial 문법 ① — eyebrow→헤드라인→서브('결과 N개' micro가 유일 타이틀이던 상태 해소) */}
      <PageHeader
        eyebrow="학생 관리"
        title="성적관리"
        description="시험을 만들고 반별 점수를 일괄 입력합니다"
      />

      {/* Filter bar */}
      {/* 🔴 툴바 카드 껍데기 제거(원장 2026-09-01) — 아래 표가 자기 테두리를 가져 선이 겹쳤다. */}
      {/* ⚠️ 칩·초기화는 `<Link>`가 아니라 하드 이동(`EmbedAnchor`)이다 — 아래 검색 폼 입력은 `defaultValue`(비제어)라
          소프트 이동이면 **옛 검색어·기간이 칸에 남아** '검색' 한 번에 도로 실린다(JJ ↔ 일반 전환 때 기간을 버리는
          2026-09-10 수리가 그 순간 무너진다). embed는 `EmbedAnchor`가 창 안이면 싣는다. */}
      <div className="flex flex-col gap-2 px-1 py-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-1.5">
            <span className="micro shrink-0">과목</span>
            <div className={TOOLBAR_SEG_BOX_WRAP}>
            {subjects.filters.map((f) => (
              <EmbedAnchor
                key={f.value}
                href={buildHref({ subject: f.value })}
                className={`${TOOLBAR_SEG_ITEM} shrink-0 ${subject === f.value ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
              >
                {f.label}
              </EmbedAnchor>
            ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="micro shrink-0">유형</span>
            <div className={TOOLBAR_SEG_BOX}>
            {typeFilters.map((f) => (
              <EmbedAnchor
                key={f.value}
                href={buildHref({ type: f.value })}
                className={`${TOOLBAR_SEG_ITEM} shrink-0 ${activeType === f.value ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
              >
                {f.label}
              </EmbedAnchor>
            ))}
            </div>
          </div>
        </div>
        <form action="/exams" method="get" className="flex flex-wrap items-center gap-2">
          {subject !== "all" ? <input type="hidden" name="subject" value={subject} /> : null}
          {activeType !== "all" ? <input type="hidden" name="type" value={activeType} /> : null}
          {/* 기간을 바꿔 '검색'해도 고른 반은 그대로(반 칩은 표 위에 선다). */}
          {jjMode && jjClass ? <input type="hidden" name="jjClass" value={jjClass} /> : null}
          {/* 창 안이면 embed도 동행 — 안 실으면 제출 순간 창 안에 전체 셸이 뜬다(클라 판정: EmbedHiddenInput). */}
          <EmbedHiddenInput />
          {/* JJ 보기는 시험명 검색이 없다(인재원 목록 전체를 기간으로만 자른다). */}
          {jjMode ? null : (
            <div className={TOOLBAR_SEARCH_BOX}>
              <EyIcon name="search" size={13} />
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="시험명"
                className="text-foreground placeholder:text-text-faint h-full w-32 bg-transparent text-(length:--control-label-sm) leading-normal focus:outline-none"
              />
            </div>
          )}
          <label className="text-text-dim flex items-center gap-1 text-xs">
            기간
            {/* JJ 기본 기간은 값으로 채우지 않는다 — 채우면 '검색' 한 번에 주소로 굳어 버린다. 실제 기간은 표 위 기간 줄이 말한다. */}
            <input
              type="date"
              name="from"
              defaultValue={jjRange && !jjRange.isDefault ? jjRange.from : from}
              className="border-line bg-bg-soft h-8 rounded-lg border px-1.5 text-xs"
            />
            <span>~</span>
            <input
              type="date"
              name="to"
              defaultValue={jjRange && !jjRange.isDefault ? jjRange.to : to}
              className="border-line bg-bg-soft h-8 rounded-lg border px-1.5 text-xs"
            />
          </label>
          <Button type="submit" variant="outline">검색</Button>
          {q || from || to ? (
            <EmbedAnchor href={buildHref({ q: "", from: "", to: "" })} className="text-text-faint hover:text-foreground text-xs underline">
              초기화
            </EmbedAnchor>
          ) : null}
        </form>
      </div>

      {jjMode && viewer && jjRange ? (
        <div className="space-y-4">
          {/* 인재원 호출(0.1~1초)이 첫 페인트를 막지 않게 스켈레톤을 먼저 흘린다(B7). */}
          {/* 반 칩(aywa 영어 반)은 보기 안에 선다 — 반 목록 조회가 페이지 첫 페인트를 막지 않게(B7). */}
          <Suspense key={`${jjMode}:${jjRange.from}:${jjRange.to}:${jjClass}`} fallback={<JjSkeleton />}>
            {jjMode === "jj" ? (
              <JjStudyView
                viewer={viewer}
                range={jjRange}
                classFilter={jjClass || null}
                classHref={(id) => buildHref({ jjClass: id ?? "" })}
              />
            ) : (
              <JjExamView
                viewer={viewer}
                range={jjRange}
                classFilter={jjClass || null}
                classHref={(id) => buildHref({ jjClass: id ?? "" })}
              />
            )}
          </Suspense>
          {/* 짝 잇기(관리자) — 표 **아래**에 둔다. 표보다 일이 많아(인재원 명단 + 학원 전체 이름 인원) 늦게 오는데,
              위에 두면 도착하는 순간 보고 있던 표를 밀어 내렸다(적대 재리뷰 2026-09-10). */}
          {jjMode === "jj" ? (
            // `#jj-link` — 원스크린 영어 칸의 '인재원 미연결 → 연결하러 가기'가 여기로 온다(english-jj-status-line.tsx).
            <div id="jj-link" className="scroll-mt-4">
              <Suspense fallback={null}>
                <JjLinkSection viewer={viewer} />
              </Suspense>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="micro">
              결과 <span className="text-foreground font-bold">{total}</span>개
              {totalPages > 1 ? (
                <span className="text-text-faint ml-2 normal-case">
                  · {page}/{totalPages} 페이지
                </span>
              ) : null}
            </p>
            <CreateExamTrigger classOptions={classOptions} />
          </div>

          {total === 0 ? (
            <EmptyState
              compact
              image="exams"
              icon={() => <SearchX size={32} strokeWidth={1.8} />}
              title={
                q || from || to || subject !== "all" || examType !== "all"
                  ? "조건에 맞는 시험이 없습니다"
                  : "등록된 시험이 없습니다"
              }
              description="위에서 검색 조건을 바꾸거나 시험을 등록할 수 있습니다."
            />
          ) : (
            <>
              <ExamTable rows={rows} subjects={subjects} />
              <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function ExamTable({ rows, subjects }: { rows: ExamRow[]; subjects: SubjectMaps }) {
  return (
    <div className="bg-card shadow-card overflow-auto rounded-2xl">
      <table className="w-full text-sm [&_td]:whitespace-nowrap">
        <thead className="border-line border-b [&_th]:whitespace-nowrap">
          <tr>
            <th className="micro px-4 py-3 text-left">시험일</th>
            <th className="micro px-4 py-3 text-left">과목</th>
            <th className="micro px-4 py-3 text-left">유형</th>
            <th className="micro px-4 py-3 text-left">시험명</th>
            <th className="micro px-4 py-3 text-right">응시</th>
            <th className="micro px-4 py-3 text-right">평균</th>
            <th className="micro px-4 py-3 text-right">최고</th>
            <th className="micro px-4 py-3 text-right">최저</th>
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {rows.map((e) => {
            const meta = { label: subjects.labelOf(e.subject), color: subjects.colorOf(e.subject) };
            const s = e.stats;
            return (
              <tr key={e.id} className="hover:bg-bg-soft/50">
                <td className="text-text-dim num px-4 py-2.5 text-xs">{e.examDate}</td>
                <td className="px-4 py-2.5">
                  <Pill color={meta.color}>{meta.label}</Pill>
                </td>
                <td className="text-text-dim px-4 py-2.5 text-xs">
                  {TYPE_LABEL[e.examType] ?? e.examType}
                </td>
                <td className="px-4 py-2.5">
                  <WindowLink
                    href={`/exams/${e.id}`}
                    title={e.name}
                    className="text-foreground text-sm font-bold hover:underline"
                  >
                    {e.name}
                  </WindowLink>
                </td>
                <td className="text-foreground num px-4 py-2.5 text-right text-xs font-bold">
                  {s.count}명
                </td>
                <td className="text-text-dim num px-4 py-2.5 text-right text-xs">
                  {s.avg ?? "—"}
                  {s.avgPct != null ? (
                    <span className="text-text-faint ml-1">({s.avgPct}%)</span>
                  ) : null}
                </td>
                <td className="text-text-dim num px-4 py-2.5 text-right text-xs">{s.max ?? "—"}</td>
                <td className="text-text-dim num px-4 py-2.5 text-right text-xs">{s.min ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
