import Link from "next/link";
import {
  MessagesSquare,
  CalendarClock,
  BellRing,
  AlarmClock,
  Mic,
  Sparkles,
} from "@/components/icons/eywa-icon-compat";
import { BigStat } from "@/components/atoms/big-stat";
import { WindowLink } from "@/components/workspace/window-link";
import { SearchForm } from "@/components/search-form";
import { MakeeduSyncBadge } from "@/components/makeedu-sync-badge";
import { MakeeduOriginTag } from "@/components/makeedu-origin-tag";
import { EditingBadge } from "@/features/presence/editing-badge";
import { Pill } from "@/components/atoms/pill";
import { PhotoCard } from "@/components/atoms/photo-card";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import {
  followUpUrgency,
  getStudentConsultationCounts,
  getStudentConsultationsPage,
  type StudentConsultationCategory,
} from "@/features/consultations/server/queries";
import { Pagination } from "@/components/pagination";
import { NewConsultationTrigger } from "./_components/new-consultation-trigger";
import { ConsultationDeleteButton } from "./_components/consultation-delete-button";
import { CATEGORY_META, URGENCY_META } from "./_components/consultation-meta";
import { relativeTimeKo } from "@/lib/relative-time";

export const metadata = { title: "학생상담 — eywa" };

type RangeKey = "all" | "7d" | "30d";
type CategoryKey = "all" | StudentConsultationCategory;
type UrgencyKey = "all" | "overdue" | "today" | "soon" | "later" | "done";

const RANGE_FILTERS: { key: RangeKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "7d", label: "최근 7일" },
  { key: "30d", label: "최근 30일" },
];

const CATEGORY_FILTERS: { key: CategoryKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "academic", label: "학습" },
  { key: "emotional", label: "정서" },
  { key: "career", label: "진로" },
  { key: "social", label: "교우" },
  { key: "general", label: "일반" },
  { key: "other", label: "기타" },
];

const URGENCY_FILTERS: { key: UrgencyKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "overdue", label: "지연" },
  { key: "today", label: "오늘" },
  { key: "soon", label: "3일 내" },
  { key: "later", label: "예정" },
  { key: "done", label: "완료" },
];

function buildHref(p: { range: RangeKey; cat: CategoryKey; urg: UrgencyKey; q: string }): string {
  const sp = new URLSearchParams();
  if (p.range !== "all") sp.set("range", p.range);
  if (p.cat !== "all") sp.set("cat", p.cat);
  if (p.urg !== "all") sp.set("urg", p.urg);
  if (p.q) sp.set("q", p.q);
  const s = sp.toString();
  return s ? `/consultations?${s}` : "/consultations";
}

export default async function ConsultationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: RangeKey;
    cat?: CategoryKey;
    urg?: UrgencyKey;
    q?: string;
    page?: string;
  }>;
}) {
  await requireAccess("consultations");
  const sp = await searchParams;
  const range: RangeKey = (sp.range as RangeKey) ?? "all";
  const cat: CategoryKey = (sp.cat as CategoryKey) ?? "all";
  const urg: UrgencyKey = (sp.urg as UrgencyKey) ?? "all";
  const q = sp.q ?? "";
  const PAGE_SIZE = 50;
  const page = Math.max(1, Number(sp.page) || 1);

  const [{ rows: items, total }, counts] = await Promise.all([
    getStudentConsultationsPage({ q, range, cat, urg }, page, PAGE_SIZE),
    getStudentConsultationCounts(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const { total: totalAll, lastWeek, pendingFollowUps, overdueFollowUps } = counts;

  const current = { range, cat, urg, q };

  // 현재 필터 보존 + page만 변경 (필터 chip은 buildHref라 page 자동 리셋)
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (range !== "all") params.set("range", range);
    if (cat !== "all") params.set("cat", cat);
    if (urg !== "all") params.set("urg", urg);
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/consultations?${s}` : "/consultations";
  };

  return (
    // 컴팩트 크롬(창·모바일·강사 미니셸)에선 섹션 간격을 좁힌다(원장 지시 2026-08-06 "남는 공간 많음").
    <div className="space-y-5 compact-chrome:space-y-3">
      {/* Stat strip — Editorial 문법 ②(공용 BigStat, 구 로컬 Stat 대체) */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <BigStat label="전체 상담" value={totalAll} unit="건" tone="primary" icon={<MessagesSquare size={16} strokeWidth={1.8} />} />
        <BigStat label="최근 7일" value={lastWeek} unit="건" tone="blue" icon={<CalendarClock size={16} strokeWidth={1.8} />} />
        <BigStat label="진행 중 후속" value={pendingFollowUps} unit="건" tone="gold" icon={<BellRing size={16} strokeWidth={1.8} />} />
        <BigStat
          label="지연 후속"
          value={overdueFollowUps}
          unit="건"
          tone="danger"
          valueClass={overdueFollowUps > 0 ? "text-danger" : undefined}
          icon={<AlarmClock size={16} strokeWidth={1.8} />}
        />
      </section>

      {/* Filter bar — 소프트 패널 + 알약 칩 */}
      <div className="bg-card shadow-card space-y-3 rounded-2xl px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">기간</span>
            {RANGE_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={buildHref({ ...current, range: f.key })}
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${
                  range === f.key
                    ? "border-foreground bg-foreground text-background font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <span className="bg-line h-4 w-px" aria-hidden />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">카테고리</span>
            {CATEGORY_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={buildHref({ ...current, cat: f.key })}
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${
                  cat === f.key
                    ? "border-primary bg-primary text-primary-foreground font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">후속</span>
            {URGENCY_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={buildHref({ ...current, urg: f.key })}
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${
                  urg === f.key
                    ? "border-foreground bg-foreground text-background font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <SearchForm placeholder="학생명·요약" defaultValue={q} />
        </div>
      </div>

      {/* ⚠️ 동기화 배지를 이 행에 태운다 — 맨 위에 따로 두면 배지 하나가 한 줄을 통째로 먹는다(우측 텅 빔). */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-text-dim px-1 text-[13px]">
          결과 <span className="text-foreground font-bold">{total}</span>건
          {totalPages > 1 ? (
            <span className="ml-2">
              {page}/{totalPages} 페이지
            </span>
          ) : null}
        </p>
        <div className="flex items-center gap-2">
          <MakeeduSyncBadge domain="consultations" />
          <Button
            variant="outline"
            render={<WindowLink href="/consultations/stats" title="상담 통계" />}
          >
            <MessagesSquare className="size-4" strokeWidth={1.8} />
            통계 보기
          </Button>
          <NewConsultationTrigger />
        </div>
      </div>

      {total === 0 ? (
        <div className="mx-auto max-w-xl py-4">
          <PhotoCard
            src="/photos/consultations-hero.webp"
            alt=""
            caption="기록된 상담이 없습니다"
            sub="상담 추가로 첫 기록을 남겨 보세요"
            aspect="3/2"
            sizes="(max-width: 768px) 100vw, 576px"
          />
        </div>
      ) : (
        <>
        <ul className="space-y-2.5">
          {items.map((c) => {
            const urgency = URGENCY_META[followUpUrgency(c.followUpDate, c.followUpDone)];
            const cat = c.category ? CATEGORY_META[c.category] : null;
            const isUrgent =
              urgency &&
              (urgency.color === "danger" || urgency.color === "amber");
            return (
              <li
                key={c.id}
                className={`group shadow-card relative overflow-hidden rounded-2xl border p-5 transition hover:shadow-modal ${
                  isUrgent
                    ? "border-danger/30 bg-danger-soft hover:border-danger/50"
                    : "border-line bg-card hover:border-primary/40"
                }`}
              >
                {/* 카드 전체 클릭 → 상담 상세(읽기 — 다른 엔티티와 일관, 수정은 상세의 버튼).
                    내부 학생 이름 링크는 z-10로 위에 둠. */}
                <WindowLink
                  href={`/consultations/${c.id}`}
                  title="상담 상세"
                  ariaLabel={`${c.studentName} 상담 상세`}
                  className="absolute inset-0 z-0"
                />
                <header className="relative flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <WindowLink
                          href={`/students/${c.studentId}`}
                          title={c.studentName}
                          className="text-foreground relative z-10 text-[15px] font-bold hover:underline"
                        >
                          {c.studentName}
                        </WindowLink>
                        {c.syncAddedAt ? <MakeeduOriginTag /> : null}
                        <EditingBadge scope={`student-consultation:${c.id}`} />
                        {c.studentGrade ? (
                          <span className="text-text-dim text-xs">{c.studentGrade}</span>
                        ) : null}
                        {cat ? <Pill color={cat.color}>{cat.label}</Pill> : null}
                        {urgency ? <Pill color={urgency.color}>{urgency.label}</Pill> : null}
                        {c.hasAudio ? (
                          <span className="text-primary relative z-10" title="녹음 있음">
                            <Mic className="size-3.5" />
                          </span>
                        ) : null}
                        {c.hasAi ? (
                          <span className="text-gold relative z-10 inline-flex items-center gap-0.5 text-[10px] font-bold" title="AI 분석됨">
                            <Sparkles className="size-3" />
                            AI
                          </span>
                        ) : null}
                      </div>
                      <p className="text-text-dim mt-0.5 text-[11px]">
                        {c.subject ? <span>{c.subject} · </span> : null}
                        {c.counselorName ? <span>{c.counselorName} 상담</span> : null}
                      </p>
                    </div>
                  </div>
                  <div className="text-text-dim relative z-10 flex items-center gap-3 text-xs">
                    <span className="num">{relativeTimeKo(c.consultedAt)}</span>
                    <ConsultationDeleteButton id={c.id} studentId={c.studentId} label="" />
                  </div>
                </header>

                <p className="text-foreground mt-3 line-clamp-2 text-[13px] leading-relaxed">{c.summary}</p>

                {c.followUpAction || c.followUpDate ? (
                  <div className="border-line mt-3 flex items-center justify-between gap-2 border-t pt-3">
                    {/* 구 font-mono uppercase 'Follow-up' 영문 라벨 → 한글 승격(코딩틱 제거) */}
                    <p className="text-text-dim text-[12px]">
                      <span className="text-gold mr-2 font-bold">후속 조치</span>
                      {c.followUpAction ?? "—"}
                      {c.followUpDate ? (
                        <span className="num text-text-faint ml-2">· 기한 {c.followUpDate}</span>
                      ) : null}
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
        </>
      )}
    </div>
  );
}
