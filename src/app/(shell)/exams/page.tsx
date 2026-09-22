import { Suspense } from "react";
import { SearchX } from "@/components/icons/aywa-icon-compat";
import { EmptyState } from "@/components/empty-state";
import { FilterSelect } from "@/components/filter-select";
import { HrefSelect, type HrefSelectOption } from "@/components/href-select";
import { PageHeader } from "@/components/page-header";
import { Toolbar } from "@/components/toolbar";
import { requireAccess } from "@/lib/auth/require-access";
import { kstToday } from "@/lib/date-kst";
import { JJ_STUDY_MAX_DAYS, ijwStudyDay, resolveJjRange, type JjRange } from "@/features/ijw/range";
import { ijwConfigFor } from "@/features/ijw/server/client";
import { getJjViewer } from "@/features/ijw/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { EXAM_SLOT_LABEL, examSlotOptions } from "@/features/grades/exam-slots";
import { resolveGradeSelection } from "@/features/grades/selection";
import { gradeWriteError } from "@/features/grades/server/access";
import { getGradeSheet } from "@/features/grades/server/queries";
import { axisLabelFor, axisOptionsFrom, axisValueOf } from "@/features/grades/subject-axis";
import { TERM_OPTIONS, termLabel, termYearOptions } from "@/features/grades/term";
import { JjExamView } from "./_components/jj-exam-view";
import { JjLinkSection } from "./_components/jj-link-section";
import { JjSkeleton } from "./_components/jj-shared";
import { JjStudyView } from "./_components/jj-study-view";
import { GradesExcelTrigger } from "./_components/excel-trigger";
import { ScoreGrid } from "./_components/score-grid";
import { SheetMetaFields } from "./_components/sheet-meta-fields";

export const metadata = { title: "성적관리 — aywa" };

/**
 * 성적관리 — **시험을 등록하지 않는다**(원장 2026-09-22: *"시험자체를 등록하는게 아니라 과목 반별
 * 형식으로 학생리스트가 뜨고 바로 이렇게 쭈루룩 입력할 수 있게"*).
 * `년도 · 학기 · 과목 · 반 · 시험`을 고르면 그 학기 명단이 서고 점수를 바로 적는다.
 *
 * 🔑 영어는 **고르는 자리에서만** 인재원/EiE로 갈린다 — 저장되는 과목은 `english` 하나라
 *    학생 상세·추이·급락 감지는 영어를 한 과목으로 본다(subject-axis.ts).
 * ⚠️ 인재원 연동 보기(JJ실 학습·단어시험, 2026-09-10)는 그대로 산다 — 데이터가 다른 화면이라
 *    '보기' 축으로 나란히 둔다(영어 + 연동 학원 + 영어 담당일 때만).
 */
const JJ_VIEWS = new Set(["jj", "jj_exam"]);

export default async function ExamsPage({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string;
    term?: string;
    subject?: string;
    class?: string;
    slot?: string;
    date?: string;
    max?: string;
    view?: string;
    /** 옛 주소(2026-09-10 JJ 보기) 호환 — `type=jj`가 즐겨찾기에 남아 있다. */
    type?: string;
    from?: string;
    to?: string;
    jjClass?: string;
    embed?: string;
  }>;
}) {
  const user = await requireAccess("exams");
  const sp = await searchParams;
  // 같은 이름의 주소 값이 두 번 오면 배열이 된다 — 문자열일 때만 읽는다(`.trim()` TypeError 방지).
  const one = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const isEmbed = one(sp.embed) === "1";
  const rawView = one(sp.view) || one(sp.type);
  const from = one(sp.from);
  const to = one(sp.to);
  const jjClass = one(sp.jjClass);

  const settings = await getTenantSettings();
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const subjectOptions = axisOptionsFrom(subjects.options);
  const sel = resolveGradeSelection(
    {
      year: sp.year,
      term: sp.term,
      subject: sp.subject,
      class: sp.class,
      slot: sp.slot,
      date: sp.date,
      max: sp.max,
    },
    { subjectOptions: subjects.options, todayIso: kstToday() },
  );

  if (!sel) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="학생 관리" title="성적관리" description="반별로 점수를 바로 입력합니다" />
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

  const jjEnabled = !!ijwConfigFor(user.tenantId);
  const isEnglish = sel.subject === "english";
  const wantsJj = jjEnabled && isEnglish && JJ_VIEWS.has(rawView);

  const [viewer, writeError, sheetFirst] = await Promise.all([
    jjEnabled && isEnglish ? getJjViewer() : Promise.resolve(null),
    gradeWriteError(),
    wantsJj ? Promise.resolve(null) : getGradeSheet(sel),
  ]);
  const jjAvailable = !!viewer?.hasEnglish;
  const jjMode = wantsJj && jjAvailable ? (rawView as "jj" | "jj_exam") : null;
  // 드묾: 주소는 JJ인데 이 사람에게 JJ가 없으면(수학만 맡은 강사) 그때 성적표를 읽는다.
  const sheet = jjMode ? null : (sheetFirst ?? (await getGradeSheet(sel)));

  const jjRange: JjRange | null =
    jjMode === "jj"
      ? resolveJjRange({ from, to }, { today: ijwStudyDay(), defaultDays: 7, maxDays: JJ_STUDY_MAX_DAYS })
      : jjMode === "jj_exam"
        ? resolveJjRange({ from, to }, { today: kstToday(), defaultDays: 30 })
        : null;

  const buildHref = (patch: Partial<Record<string, string>>) => {
    const cur: Record<string, string> = {
      year: String(sel.year),
      term: String(sel.term),
      subject: axisValueOf(sel),
      class: sel.classId ?? "",
      slot: sel.slot,
      date: sel.date,
      max: String(sel.maxScore),
      view: jjMode ?? "",
      jjClass: jjMode ? jjClass : "",
      from: jjMode ? from : "",
      to: jjMode ? to : "",
      ...patch,
    };
    // 과목을 바꾸면 반·시험 칸이 통째로 달라진다 — 옛 값이 따라가면 엉뚱한 반이 고정되거나 그 과목에
    // 없는 시험이 주소에 남는다(해석은 폴백하지만 주소가 거짓말을 한다).
    if (patch.subject !== undefined && patch.subject !== axisValueOf(sel)) {
      cur.class = "";
      if (patch.slot === undefined) cur.slot = "";
    }
    // 영어가 아니면 JJ 보기가 없다.
    if (!cur.subject.startsWith("english")) cur.view = "";
    if (!JJ_VIEWS.has(cur.view)) {
      cur.jjClass = "";
      // 🔴 JJ ↔ 성적표를 오갈 땐 기간을 버린다 — 날짜 기준이 다르다(학습일·제출일 ↔ 시험일).
      cur.from = "";
      cur.to = "";
    }
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(cur)) if (v) params.set(k, v);
    if (isEmbed) params.set("embed", "1");
    const s = params.toString();
    return s ? `/exams?${s}` : "/exams";
  };

  const excelHref = (() => {
    const p = new URLSearchParams({
      year: String(sel.year),
      term: String(sel.term),
      subject: axisValueOf(sel),
      slot: sel.slot,
      date: sel.date,
      max: String(sel.maxScore),
    });
    if (sel.classId) p.set("class", sel.classId);
    return `/api/exams/excel?${p.toString()}`;
  })();

  const yearOptions: HrefSelectOption[] = termYearOptions(kstToday()).map((y) => ({
    value: String(y),
    label: `${y}년`,
    href: buildHref({ year: String(y) }),
  }));
  const termOptions: HrefSelectOption[] = TERM_OPTIONS.map((t) => ({
    ...t,
    href: buildHref({ term: t.value }),
  }));
  const subjectSelectOptions: HrefSelectOption[] = subjectOptions.map((o) => ({
    ...o,
    href: buildHref({ subject: o.value }),
  }));
  const slotOptions: HrefSelectOption[] = examSlotOptions(sel.subject).map((o) => ({
    ...o,
    href: buildHref({ slot: o.value }),
  }));
  // 반은 **형광 표기 드롭다운**이다(원장 2026-08-18 규약: "반을 고르면 그 반의 내용이 아래를 채우는"
  // 자리에만 켠다 — 옛 시험 상세가 갖고 있던 표기를 이 화면이 이어받는다). 전체일 땐 저절로 꺼진다.
  // ⚠️ `cap`을 올려 둔다 — 반이 80개를 넘어 기본 50이면 한 묶음이 통째로 가린다([[#84]]).
  const classOptions = (sheet?.classes ?? []).map((c) => ({
    value: c.id,
    label: c.className,
    hint: c.studentCount == null ? undefined : `${c.studentCount}명`,
  }));
  const viewOptions: HrefSelectOption[] = [
    { value: "", label: "성적 입력", href: buildHref({ view: "" }) },
    { value: "jj", label: "JJ실", href: buildHref({ view: "jj" }) },
    { value: "jj_exam", label: "JJ실(시험)", href: buildHref({ view: "jj_exam" }) },
  ];

  const canWrite = !writeError;
  const lockReason = writeError ?? (sheet && !sheet.schemaReady ? "성적 표 준비(0283a)가 아직 적용되지 않아 입력을 잠갔습니다 — 적용 후 저장할 수 있습니다" : null);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="학생 관리"
        title="성적관리"
        description={`${termLabel(sel.year, sel.term)} · ${axisLabelFor(sel, subjects.labelOf)} · ${EXAM_SLOT_LABEL[sel.slot]}`}
        embedLabel={`${termLabel(sel.year, sel.term)} · ${EXAM_SLOT_LABEL[sel.slot]}`}
      />

      <Toolbar>
        {jjAvailable ? (
          <HrefSelect axisLabel="보기" ariaLabel="보기 선택" value={jjMode ?? ""} options={viewOptions} />
        ) : null}
        <HrefSelect axisLabel="년도" ariaLabel="년도 선택" value={String(sel.year)} options={yearOptions} />
        <HrefSelect axisLabel="학기" ariaLabel="학기 선택" value={String(sel.term)} options={termOptions} />
        <HrefSelect
          axisLabel="과목"
          ariaLabel="과목 선택"
          value={axisValueOf(sel)}
          options={subjectSelectOptions}
        />
        {jjMode ? null : (
          <>
            <FilterSelect
              paramName="class"
              axisLabel="반"
              ariaLabel="반 선택"
              value={sel.classId ?? ""}
              options={classOptions}
              cap={300}
              marker
            />
            <HrefSelect axisLabel="시험" ariaLabel="시험 선택" value={sel.slot} options={slotOptions} />
            {/* 시험일·만점은 주소에 실린다 — 격자·엑셀·저장이 같은 값을 본다(한쪽만 바뀌면 시트가
                화면과 다른 칸을 가리킨다). 클라 조각이 `__V__` 자리에 값을 끼워 이동한다. */}
            <SheetMetaFields
              date={sel.date}
              maxScore={sel.maxScore}
              dateHref={buildHref({ date: "__V__" })}
              maxHref={buildHref({ max: "__V__" })}
            />
            <GradesExcelTrigger excelHref={excelHref} canWrite={canWrite} />
          </>
        )}
      </Toolbar>

      {jjMode && viewer && jjRange ? (
        <div className="space-y-4">
          {/* 인재원 호출(0.1~1초)이 첫 페인트를 막지 않게 스켈레톤을 먼저 흘린다(B7). */}
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
          {jjMode === "jj" ? (
            // `#jj-link` — 원스크린 영어 칸의 '인재원 미연결 → 연결하러 가기'가 여기로 온다.
            <div id="jj-link" className="scroll-mt-4">
              <Suspense fallback={null}>
                <JjLinkSection viewer={viewer} />
              </Suspense>
            </div>
          ) : null}
        </div>
      ) : sheet && sheet.rows.length > 0 ? (
        <ScoreGrid
          /* 🔴 축이 바뀌면 **다시 마운트**한다 — 격자는 입력값을 제 상태로 들고 있어서, 키가 없으면
             중간고사에 친 점수가 기말고사 칸에 그대로 남는다(반·학기를 바꿔도 같다). 시험일·만점은
             키에 넣지 않는다: 그 둘은 같은 칸의 속성이라, 넣으면 적다 만 점수가 사라진다. */
          key={`${sel.year}:${sel.term}:${sel.subject}:${sel.track ?? ""}:${sel.classId ?? ""}:${sel.slot}`}
          sheet={sheet}
          canWrite={canWrite}
          slotLabel={EXAM_SLOT_LABEL[sel.slot]}
          lockReason={lockReason}
        />
      ) : (
        <EmptyState
          compact
          image="exams"
          icon={() => <SearchX size={32} strokeWidth={1.8} />}
          title={
            (sheet?.classes.length ?? 0) === 0
              ? "이 과목에 운영 중인 반이 없습니다"
              : "이 학기 명단이 없습니다"
          }
          description={
            (sheet?.classes.length ?? 0) === 0
              ? "수업목록에서 반을 먼저 만들거나 과목을 바꿔보세요."
              : `${termLabel(sel.year, sel.term)}에 이 반을 다닌 학생이 없습니다. 년도·학기나 반을 바꿔보세요.`
          }
        />
      )}
    </div>
  );
}
