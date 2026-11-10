import { Fragment, type CSSProperties, type ReactNode } from "react";
import type { DashboardDesign } from "@/features/dashboard/overview/chart-prefs";
import { DEFAULT_LAYOUT, KPI_KEYS, type KpiKey, type OverviewLayout, type PanelId } from "@/features/dashboard/overview/layout";
import type { ResolvedView } from "@/features/dashboard/layout/view";
import { BREAKPOINTS, layoutAt } from "@/features/dashboard/layout/flow";
import { dropEmptyHeadings } from "@/features/dashboard/layout/engine";
import { positionItems } from "@/features/dashboard/layout/fixed-grid";
import { fitContentRows } from "@/features/dashboard/layout/grid-rows";
import { cardDef } from "@/features/dashboard/layout/registry";
import { isHeadingId, isSpaceId, isStructuralId } from "@/features/dashboard/layout/types";
import { EXIT_BASIS_TAG } from "@/features/withdrawals/exit-basis";
import { InstrumentsSkeleton } from "../_instruments/instruments-skeleton";
import { kpiGridVars } from "./kpi-grid-vars";
import appearance from "./appearance.module.css";
import g from "./grid-board.module.css";
import s from "./overview.module.css";

/**
 * 운영실 로딩 뼈대 — `loading.tsx`(머리 + KPI 띠)와 `overview-server.tsx`의 Suspense fallback(배치를 안 뒤의 전체 모양)이 같이 쓴다.
 *
 * 🔑 치수를 손으로 다시 짓지 않는다: 실물(`overview.tsx`·`kpi-card.tsx`·`grid-board.tsx`)과 **같은 래퍼·클래스·`data-overview` 표식**을
 *    달아 같은 CSS(overview.module.css + appearance.module.css + grid-board.module.css)를 입히고, 글자는 **투명한 같은 길이**로 넣어
 *    줄 높이를 그대로 얻는다. 열 수·접힘도 같은 컨테이너 쿼리 한 벌로 같아진다.
 * ⚠️ 모듈 CSS는 Tailwind 유틸리티(@layer)보다 늘 이긴다 — 모듈이 글자색·배경을 주는 요소(.jump·.designSwitch·h1>span·small…)에
 *    투명 클래스를 같이 달면 글자가 그대로 보인다. 그런 자리는 **안쪽 span**에 투명 클래스를 단다.
 * 고정 글자(날짜·달)는 넣지 않는다 — 폭만 잡는 일반 글자다.
 */
const PULSE = "bg-bg-soft animate-pulse rounded";
const T = `text-transparent ${PULSE}`;

/** 글자 폭 잡이 — 투명 글자 + 맥박 배경. */
function Ghost({ children }: { children: ReactNode }) {
  return <span className={T}>{children}</span>;
}

// ── 머리 ──────────────────────────────────────────────────────────────

/** 실물 머리(`overview.tsx` header) — 제목·날짜 · 그림 96×64 · '대시보드 전환' · 갱신 상태 · 새로고침. */
function HeaderSkeleton({ scopeLabel }: { scopeLabel?: string }) {
  return (
    <header className={s.header} data-overview="header">
      <div className={s.identity}>
        {/* 확정 디자인은 이 줄을 숨긴다(appearance `> div:first-child > span`) — 실물과 같은 자리에 둬 같은 규칙을 탄다. */}
        <span className={s.eyebrow}>
          <Ghost>에이와 · ACADEMY OVERVIEW</Ghost>
        </span>
        <h1>
          <i className={`not-italic ${T}`}>학원 전체 현황{scopeLabel ? ` (${scopeLabel})` : ""}</i>
          <span>
            <Ghost>0000.00.00</Ghost>
          </span>
        </h1>
      </div>
      {/* 그림 자리 — 크기는 실물과 같은 클래스(96×64)에서 온다. */}
      <span className={`${appearance.headerArtwork} ${PULSE} block`} aria-hidden />
      <div className={s.headerTools}>
        <span className={s.designSwitch} aria-hidden>
          <Ghost>대시보드 전환</Ghost>
        </span>
        <div className={s.freshness}>
          <i className={s.dotLive} />
          <span>
            <Ghost>자동 갱신</Ghost>
            <small>
              <Ghost>00:00 확인 · 5분 주기</Ghost>
            </small>
          </span>
        </div>
        <span className={s.refresh} aria-hidden />
      </div>
    </header>
  );
}

/** 운영실 겉틀(래퍼·표식) + 머리. `footer`는 본문 모양을 알 때(Suspense fallback)만 — `loading.tsx`는 KPI 띠까지만 그린다. */
export function OverviewFrameSkeleton({ scopeLabel, footer = false, children }: { scopeLabel?: string; footer?: boolean; children?: ReactNode }) {
  return (
    <div className={appearance.dashboard}>
      <div className={s.root} data-overview="root" aria-busy="true" aria-label="학원 전체 현황을 불러오는 중">
        <div className={s.board} data-overview="board">
          <HeaderSkeleton scopeLabel={scopeLabel} />
          {children}
          {footer ? (
            <footer className={s.footer}>
              <Ghost>에이와 / OVERVIEW</Ghost>
            </footer>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── KPI ───────────────────────────────────────────────────────────────

/** 칸마다 기간 꼬리표·값 폭(`kpi-strip.tsx`의 labelNote·value·unit과 같은 길이). 이름은 레지스트리 이름 = 실제 `data-kpi`. */
const KPI_SHAPE: Record<KpiKey, { note?: string; value: string; unit: string }> = {
  students: { note: "현재", value: "000", unit: "명" },
  courses: { note: "현재", value: "000", unit: "개" },
  withdrawals: { note: "이번달 (00.00)", value: "0", unit: "명" },
  intake: { note: "오늘", value: "0", unit: "건" },
  calendar: { value: "0", unit: "건" },
  enrolledToday: { value: "0 / 0", unit: "명" },
  firstClass: { value: "0", unit: "명" },
  absent: { note: "7일", value: "0", unit: "명" },
  makeup: { note: "한 달", value: "0", unit: "건" },
};

/**
 * KPI 한 칸 — 실물(`KpiCard`)처럼 **라벨과 값뿐**이다(보조 줄은 09-12에 실물에서 지웠다 — 값은 접근성 설명에만 남는다).
 * 몸통도 실물처럼 `button`이라 같은 여백·값 크기 규칙을 입는다. 로딩 중엔 누를 일이 없어 포커스·보조기기에서 뺀다(disabled ·
 * tabIndex -1 · aria-hidden — `.kpiBody`엔 :disabled 규칙이 없어 모양은 같다).
 * `kpi` = 원래 라벨(`data-kpi` — 최근 결석 틴트 · 전일 / 이달 신규 값 크기 같은 칸 규칙이 이 값을 본다), `name` = 보이는 이름.
 */
function KpiSkeleton({ kpi, name, note, value, unit }: { kpi: string; name: string; note?: string; value: string; unit: string }) {
  return (
    <div className={s.kpi} data-overview="kpi" data-kpi={kpi}>
      <button type="button" className={`${s.kpiBody} pointer-events-none`} disabled tabIndex={-1} aria-hidden>
        <span className={s.kpiLabel} data-overview="kpi-label">
          <span className={s.kpiIcon}>
            {/* 아이콘 그림은 확정 디자인에서 26px(appearance `kpi-label img`) — 좁은 띠에선 이 칸째 숨는다. */}
            <i className={`${PULSE} block size-[26px]`} />
          </span>
          <span className={s.kpiName}>
            <Ghost>{name}</Ghost>
          </span>
          {note ? (
            <small className={s.kpiPeriod}>
              <Ghost>{note}</Ghost>
            </small>
          ) : null}
        </span>
        <span className={s.kpiValue} data-overview="kpi-value">
          <i className={`not-italic ${T}`}>{value}</i>
          <span>
            <Ghost>{unit}</Ghost>
          </span>
        </span>
      </button>
    </div>
  );
}

function kpiOf(key: KpiKey, view?: Pick<ResolvedView, "academyWide" | "items">) {
  const id = `kpi:${key}`;
  const label = cardDef(id)?.label ?? key;
  const shape = KPI_SHAPE[key];
  // 새 대시보드 전용 칸(오늘 입테)은 옛 운영실 뼈대에 없다 — 그리지 않는다.
  if (!shape) return null;
  // 과목 관리자 화면의 '학원 전체' 꼬리표(`kpi-strip.tsx` noteOf) — 폭이 달라 같이 싣는다.
  const wide = view?.academyWide.includes(id);
  const note = wide ? (shape.note ? `${shape.note} · 학원 전체` : "학원 전체") : shape.note;
  const name = view?.items?.find((i) => i.id === id)?.title ?? label;
  return <KpiSkeleton kpi={label} name={name} note={note} value={shape.value} unit={shape.unit} />;
}

/** KPI 띠(`KpiStrip`) — 열 수는 실물과 같은 함수(`kpiGridVars`). */
export function KpiStripSkeleton({ keys }: { keys: readonly KpiKey[] }) {
  if (!keys.length) return null;
  return (
    <div className={s.kpis} style={kpiGridVars(keys.length)} data-overview="kpis" data-kpi-n={keys.length}>
      {keys.map((k) => (
        <Fragment key={k}>{kpiOf(k)}</Fragment>
      ))}
    </div>
  );
}

// ── 패널 ──────────────────────────────────────────────────────────────

/**
 * 패널 머리 안내(같은 길이의 일반 글자)와 본문 높이(흔한 내용 높이의 근삿값) — 이름은 레지스트리 이름(날짜가 든 제목은 '이번 달'로).
 * 넓이·줄 차지는 실물 `overview.tsx`의 `wide`·`className`과 같다.
 */
const PANEL_SHAPE: Record<PanelId, { note: string; body: number; wide?: boolean; className?: string }> = {
  studentsComp: { note: "현재 · 초·중·고 · 영어·동시수강·수학", body: 150 },
  attendance: { note: "오늘 · 학생·반·교시별 출결 칸", body: 205 },
  billingMonth: { note: "이번 달 청구서 · 취소 청구 제외", body: 195 },
  newcomerStages: { note: "등록 후 90일 · 재원·휴원 학생", body: 180 },
  changes: { note: `최근 6개월 · 당월은 오늘까지 · 퇴원은 ${EXIT_BASIS_TAG}`, body: 245, wide: true },
  earlyExits: { note: `이번 달 퇴원(${EXIT_BASIS_TAG}) · 등록일부터 30·60·90일`, body: 200 },
  billing6: { note: "최근 6개월 · 청구월 기준 실청구액(청구 − 할인)", body: 245, wide: true },
  enrolledTrend: { note: `최근 12개월 · 달마다 말일 기준(이번 달은 오늘) · 휴원 제외 · 퇴원은 ${EXIT_BASIS_TAG}`, body: 245, className: s.fullRow },
  courseTrend: { note: "최근 12개월 · 달마다 말일 기준(이번 달은 오늘) · 학생마다 같은 과목은 1개", body: 245, className: s.fullRow },
  subjects: { note: "현재 재원생 · 과목별 수강과 동시 수강", body: 300 },
  grades: { note: "현재 재원생 · 학원설정 학년 순 · 영어·수학 수강 구성", body: 300 },
  schools: { note: "현재 재원생 · 초등·중등·고등", body: 520, className: s.schoolPanel },
  admissions: { note: "지난달 · 이번 달 · 접수일 기준", body: 170 },
  repeatAbsence: { note: "최근 14일 · 사전 통보 제외", body: 180 },
  attendance14: { note: "오늘 포함 14일 · (출석 + 지각) / 유효 출결 칸", body: 200 },
  consultProgress: { note: "접수일 기준 최근 30일 · 접수 → 수업 시작", body: 230 },
  reports: { note: "수업보고서 기준", body: 200 },
  studentConsult: { note: "최근 7일 · 전체 기록 · 후속조치", body: 180 },
  newcomerChecks: { note: "등록 후 90일 · 필수 6항목 · 2개월 콜은 선택", body: 230 },
  sheets: { note: "영어 이번 주(보기 필터 기준) · 수학 이번 달", body: 160 },
  teacherWork: { note: "현재 담당 반 · 보고서·영상 숙제 최근 7일 · 출결 어제까지 7일", body: 200 },
  nowClasses: { note: "오늘 00:00 기준 · 과목별", body: 250 },
  admissionsSchedule: { note: "오늘부터 한 달 · 00/00 (0)까지", body: 250 },
  staff: { note: "현재 재직 중 · 운영 역할 기준", body: 205 },
  operations: { note: "현재 · 누적 건수 · 열람 가능한 업무 기준", body: 180 },
  expenses: { note: "이번 달 지출결의서 기준", body: 200 },
  notices: { note: "최근 공지 · 대상 권한 반영", body: 200 },
};

/** 패널 한 장(`Panel`) — 머리(제목·안내·상세) + 본문. 본문은 칸 높이를 채우고(자유 격자) 최소 높이는 흔한 내용 높이다. */
function PanelSkeleton({ id, title, inGrid = false }: { id: PanelId; title?: string; inGrid?: boolean }) {
  const shape = PANEL_SHAPE[id];
  const wide = !inGrid && shape.wide;
  return (
    <section className={`${s.panel} ${wide ? s.wide : ""} ${inGrid ? "" : (shape.className ?? "")}`} data-overview="panel" data-wide={wide || undefined}>
      <header className={s.panelHeader} data-overview="panel-header">
        <div>
          <h2>
            <Ghost>{title ?? cardDef(`panel:${id}`)?.label ?? id}</Ghost>
          </h2>
          <p>
            <Ghost>{shape.note}</Ghost>
          </p>
        </div>
        <div className={s.panelTools}>
          <span className={s.jump}>
            <Ghost>상세</Ghost>
          </span>
        </div>
      </header>
      <div className={`${s.panelBody} flex flex-col`} data-overview="panel-body">
        {inGrid ? (
          // 자유 격자 = 칸 높이(저장 높이)를 채울 뿐 — 내용 높이를 주면 낮은 칸에서 넘쳐 스크롤바가 생긴다.
          // 폰 폭(grid-board.module.css `max-width: 580px`)만 칸 높이가 내용을 따라가 빈 머리만 남지 않게 낮은 자리를 둔다.
          // CSS의 max-width는 580 포함이라 Tailwind 경계는 581 미만으로 적는다.
          <div className={`${PULSE} min-h-0 flex-1 @max-[581px]/dashboard:min-h-32`} />
        ) : (
          <div className={`${PULSE} min-h-0 flex-1`} style={{ minHeight: shape.body }} />
        )}
      </div>
    </section>
  );
}

// ── 원장 기본(옛 CSS 격자) ───────────────────────────────────────────────

/** 원장·총괄 기본 배치(`classic`) — KPI 띠 + 구역마다 제목줄(실물처럼 보드 바로 아래 `id` 달린 줄) + 4열 격자. */
function ClassicBodySkeleton({ layout }: { layout: OverviewLayout }) {
  return (
    <>
      <KpiStripSkeleton keys={layout.kpis ?? KPI_KEYS} />
      {layout.sections.map((section) => (
        <Fragment key={section.id}>
          {section.title ? (
            <div id={section.id} className={s.sectionLine}>
              <Ghost>{section.title}</Ghost>
              <p>
                <Ghost>{section.note}</Ghost>
              </p>
            </div>
          ) : null}
          <div className={s.grid} data-overview="grid">
            {section.panels.map((slot) =>
              slot === "followup" ? (
                <div key={slot} className={s.followupPanels}>
                  <PanelSkeleton id="reports" />
                  <PanelSkeleton id="studentConsult" />
                </div>
              ) : (
                <PanelSkeleton key={slot} id={slot} />
              ),
            )}
          </div>
        </Fragment>
      ))}
    </>
  );
}

// ── 역할·저장 배치(자유 격자) ─────────────────────────────────────────────

/**
 * 역할·과목별 배치(`GridBoard`) — 자리 계산은 실물과 **같은 함수**(positionItems → fitContentRows → layoutAt)·같은 CSS 변수다.
 * 실물은 그린 뒤 내용 높이를 재서 칸을 늘리지만 서버 첫 HTML은 저장 높이 그대로라, 여기도 저장 높이(측정 없음)로 그린다.
 * 실물은 데이터가 안 온 카드를 빼지만(권한·모듈) 그건 스냅샷이 와야 안다 — 배치(이미 권한으로 거른 `view.items`)의 카드를 다 그린다.
 */
function GridBodySkeleton({ view }: { view: ResolvedView }) {
  const items = view.items ?? [];
  const base = dropEmptyHeadings(positionItems(items).filter((i) => isStructuralId(i.id) || !!cardDef(i.id)).sort((a, b) => a.y - b.y || a.x - b.x));
  const shown = fitContentRows(base, {});
  const places = Object.fromEntries(
    BREAKPOINTS.map((bp) => [bp, new Map((bp === "mobile" ? layoutAt(shown.filter((i) => !isSpaceId(i.id)), bp) : shown).map((p) => [p.id, p]))]),
  );
  return (
    <div className={g.grid} data-overview="free-grid" data-fixed-grid="true">
      {shown.map((item) => {
        const d = places.desktop!.get(item.id)!;
        const m = places.medium!.get(item.id)!;
        const p = places.mobile!.get(item.id) ?? d;
        const vars = {
          "--dx": d.x + 1, "--dy": d.y + 1, "--dw": d.w, "--dh": d.h,
          "--mx": m.x + 1, "--my": m.y + 1, "--mw": m.w,
          "--sx": p.x + 1, "--sy": p.y + 1, "--sw": p.w,
        } as CSSProperties;
        if (isSpaceId(item.id)) return <div key={item.id} className={`${g.cell} ${g.space}`} style={vars} data-cell="space" />;
        if (isHeadingId(item.id)) {
          return (
            <div key={item.id} className={`${g.cell} ${g.heading}`} style={vars} data-cell="heading">
              <Ghost>{item.title}</Ghost>
              {item.note ? (
                <p>
                  <Ghost>{item.note}</Ghost>
                </p>
              ) : null}
            </div>
          );
        }
        const def = cardDef(item.id)!;
        const title = `${item.title ?? def.label}${view.academyWide.includes(item.id) ? " (학원 전체)" : ""}`;
        return (
          <div
            key={item.id}
            className={`${g.cell} ${item.id === "panel:teacherWork" ? g.fitCell : ""}`}
            style={vars}
            data-cell={def.kind}
            data-wide-cell={d.w >= 12 || undefined}
            data-narrow-cell={d.w <= 2 || undefined}
          >
            {def.kind === "kpi" ? (
              kpiOf(def.key as KpiKey, view)
            ) : item.mode === "summary" ? (
              // 요약형(½×1)은 실물도 KPI 칸 모양(`SummaryTile` → `KpiCard`)이다.
              <KpiSkeleton kpi={title} name={title} value="0" unit="" />
            ) : (
              <PanelSkeleton id={def.key as PanelId} title={title} inGrid />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── 고르기 ────────────────────────────────────────────────────────────

/**
 * 배치를 안 뒤의 전체 뼈대(Suspense fallback). 고르는 규칙은 실물과 같다 —
 * 디자인 `instruments` → 계기판 · `view.mode === "classic"`(원장·총괄 기본) → 옛 CSS 격자 · 그 밖(역할·저장 배치) → 자유 격자.
 */
export function OverviewSkeleton({ view, design }: { view: ResolvedView | undefined; design: DashboardDesign }) {
  if (design === "instruments") return <InstrumentsSkeleton />;
  // `overview.tsx`의 `classic` 판정 그대로(옛 스냅샷처럼 view가 없으면 원장 기본).
  const classic = !view ? DEFAULT_LAYOUT : view.mode === "classic" ? (view.classic ?? DEFAULT_LAYOUT) : null;
  const choices = view?.subjectChoices ?? [];
  return (
    <OverviewFrameSkeleton scopeLabel={view?.scopeLabel} footer>
      {choices.length > 1 ? (
        <nav className="mb-4 flex flex-wrap gap-2" aria-hidden>
          {choices.map((choice) => (
            <span key={choice.key} className="rounded-md border px-3 py-1 text-sm">
              <Ghost>{choice.label}</Ghost>
            </span>
          ))}
        </nav>
      ) : null}
      {classic ? <ClassicBodySkeleton layout={classic} /> : <GridBodySkeleton view={view!} />}
    </OverviewFrameSkeleton>
  );
}
