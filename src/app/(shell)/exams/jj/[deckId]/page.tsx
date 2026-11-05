
import { SheetText } from "@/features/teacher-view/interface-label";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import { examTypeLabel, summarizeScores } from "@/features/ijw/contract";
import {
  classRefsOfRow,
  groupRowsByClass,
  hasMultiClassStudent,
  summarizeScoreGroups,
} from "@/features/ijw/class-groups";
import { ijwConfigFor } from "@/features/ijw/server/client";
import { getJjClassOptions, getJjDeckResults, getJjViewer, loadJjMembership } from "@/features/ijw/server/queries";
import { JjClassFilter } from "../../_components/jj-class-filter";
import { JjDeckBreakdown } from "../../_components/jj-deck-breakdown";
import { JjDeckRows } from "../../_components/jj-deck-rows";
import { JJ_SCOPE_FAILED, JjFailBanner, JjLinkColumnNotice, JjNote } from "../../_components/jj-shared";

/**
 * 성적관리 › 영어 › JJ실(시험) › **시험 하나의 학생별 결과**(인재원 설명서 7번).
 * 학생마다 마지막 제출, 점수 높은 순. 강사는 짝이 걸린 자기 학생(세 갈래 스코프)만 보고, 위 요약도 그 학생들로 센다.
 * 🔑 요약은 인재원과 **같은 반올림**(평균 정수, summarizeScores) — 전체를 보는 사람에겐 시험 목록의 평균과 같은 숫자다.
 * 🔑 반별(2026-09-11): aywa 영어 반마다 응시·평균·최고·최저 + 반 칩(`?jjClass=`) — 고르면 요약·표가 그 반만.
 *    행마다 지금 다니는 aywa 반을 적고, '결과지'는 그 응시 한 장으로 연다.
 * ⚠️ 인재원 호출(최대 8초)이 창 첫 페인트를 막지 않게 loading.tsx가 먼저 선다(B7).
 */
export const metadata = { title: "JJ실 시험 결과 — 에이와" };

export default async function JjDeckPage({
  params,
  searchParams,
}: {
  params: Promise<{ deckId: string }>;
  searchParams: Promise<{ jjClass?: string }>;
}) {
  const user = await requireAccess("exams");
  if (!ijwConfigFor(user.tenantId)) notFound();
  const [{ deckId }, sp, viewer] = await Promise.all([params, searchParams, getJjViewer()]);
  // 담당(세 갈래) 반에 영어가 없는 강사에겐 JJ 칩이 없다 — 주소를 직접 쳐도 같은 답(#77).
  if (!viewer || !viewer.hasEnglish) notFound();
  if (viewer.scopeFailed) return <JjFailBanner message={JJ_SCOPE_FAILED} />;
  const [res, member, options] = await Promise.all([
    getJjDeckResults(viewer, deckId),
    loadJjMembership(viewer.tenantId),
    getJjClassOptions(viewer),
  ]);
  if (!res.ok) {
    if (res.kind === "not_found") notFound();
    return <JjFailBanner message={res.message} detail={res.detail} />;
  }
  const membership = member.ok ? member.membership : null;
  const base = `/exams/jj/${encodeURIComponent(deckId)}`;
  const hrefFor = (classId: string | null) => (classId ? `${base}?jjClass=${encodeURIComponent(classId)}` : base);
  const nameOf = (r: (typeof res.rows)[number]) => r.aywa?.name ?? (r.name || r.ijwId);
  const groups = membership
    ? groupRowsByClass(res.rows, membership, { classFilter: null, includeUnlinked: !viewer.teacherStudentIds, nameOf })
    : [];
  // 고를 수 있는 반 = 목록 화면의 반 칩과 **같은 선택지**(강사는 자기 담당 반만). 강사도 자기 학생이 다니는 남의 반
  // 줄은 보지만 그 반으로 좁히지는 못한다 — 여기서 받아 주면 '목록으로'가 그 반을 들고 가서 "찾을 수 없음"이 된다
  // (적대 리뷰 2026-09-11). 선택지를 못 읽었으면(null) 반으로 좁히지 않는다.
  const allowed = options ? new Set(options.map((c) => c.id)) : null;
  const wanted = typeof sp.jjClass === "string" ? sp.jjClass : null;
  // 반 칩 = 이 시험을 본 학생이 있는 반 + 주소로 고른 반(응시자가 0이어도 "없다"를 보여 준다).
  const picked = wanted && allowed?.has(wanted) ? membership?.classes.find((c) => c.id === wanted) : undefined;
  const filter = picked ? picked.id : null;
  const chips = membership
    ? membership.classes.filter(
        (c) => allowed?.has(c.id) && (c.id === filter || groups.some((g) => g.classRef?.id === c.id)),
      )
    : [];
  const rows = res.rows
    .filter((r) => !filter || (membership && classRefsOfRow(r, membership).some((c) => c.id === filter)))
    .map((r) => ({ ...r, classNames: membership ? classRefsOfRow(r, membership).map((c) => c.name) : [] }));
  const stats = summarizeScores(rows.map((r) => r.score));
  const breakdown = summarizeScoreGroups(groups).map(({ group, stats: s }) => ({
    key: group.key,
    classId: group.classRef?.id ?? null,
    label: group.classRef?.name ?? (group.kind === "none" ? "영어 반 없음" : "연결 필요"),
    track: group.classRef?.track ?? null,
    stats: s,
  }));
  // 🔴 `/exams?…type=jj_exam`은 옛 주소 판정(exams/page.tsx — `type==="jj"`·`view==="jj_exam"`만)에 안 걸려 통합 화면으로 갔다(2026-11-05) —
  //    JJ실(시험) 목록이 있는 입력 화면으로 바로 간다(입력 화면은 `view`가 없으면 `type`을 읽는다).
  const backHref = `/exams/input?subject=english&type=jj_exam${filter ? `&jjClass=${encodeURIComponent(filter)}` : ""}`;
  return (
    <div className="space-y-5">
      <BackLink href={backHref} label="JJ실(시험) 목록으로" />
      <header className="bg-card shadow-card rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-text-dim text-xs">
            <SheetText value={"인재원 JJ실 시험 · "} />{examTypeLabel(res.deck.examType)}
            <SheetText value={viewer.teacherStudentIds ? " · 내 학생 기준" : ""} />
            <SheetText value={picked ? ` · ${picked.name} 반 기준` : ""} />
          </p>
          <JjClassFilter classes={chips} value={filter} hrefFor={hrefFor} />
        </div>
        <h1 className="text-foreground mt-1 text-xl leading-tight font-bold">{res.deck.name}</h1>
        {res.scopeNotReady ? null : (
          <div className="border-line mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-center sm:grid-cols-4">
            <Stat label="응시" value={stats.count} unit="명" />
            <Stat label="평균" value={stats.avg} unit="점" />
            <Stat label="최고" value={stats.max} unit="점" />
            <Stat label="최저" value={stats.min} unit="점" />
          </div>
        )}
      </header>
      {res.scopeNotReady ? <JjLinkColumnNotice teacher /> : res.columnMissing ? <JjLinkColumnNotice /> : null}
      {!member.ok ? <JjNote title={member.detail}><SheetText value={"반 정보를 불러오지 못해 반별로 나누지 않았습니다."} /></JjNote> : null}
      {wanted && !picked && member.ok ? (
        <JjNote>
          <SheetText value={options ? "고른 반을 찾을 수 없어(담당 반이 아니거나 운영이 끝난 반) 전체를 보여 줍니다." : "반 목록을 불러오지 못해 전체를 보여 줍니다."} />
        </JjNote>
      ) : null}
      {res.scopeNotReady || filter ? null : (
        <JjDeckBreakdown
          items={breakdown}
          hrefFor={(id) => (allowed?.has(id) ? hrefFor(id) : null)}
          multi={hasMultiClassStudent(groups)}
        />
      )}
      {res.scopeNotReady ? null : rows.length === 0 ? (
        <p className="text-text-faint py-8 text-center text-sm">
          {picked
            ? `${picked.name} 반에서 이 시험을 본 학생이 아직 없습니다.`
            : viewer.teacherStudentIds
              ? "담당 학생 중 이 시험을 본 학생이 아직 없습니다."
              : "이 시험을 본 학생이 아직 없습니다."}
        </p>
      ) : (
        <JjDeckRows rows={rows} />
      )}
    </div>
  );
}

// 시험 상세(exams/[id])와 같은 BigStat 톤 — 큰 숫자 + 작은 라벨.
function Stat({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <div>
      <p className="text-text-dim text-sm font-medium">{label}</p>
      <p className="mt-1.5 flex items-baseline justify-center gap-1">
        <span className="num text-foreground text-3xl leading-none font-bold tracking-tight">{value ?? "—"}</span>
        {value != null && unit ? <span className="text-text-dim text-sm font-medium">{unit}</span> : null}
      </p>
    </div>
  );
}
