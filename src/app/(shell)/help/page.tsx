import { EyIcon, MENU_ICON, type EywaIconName } from "@/components/icons/eywa-icons";
import { requireAccess } from "@/lib/auth/require-access";
import { ShortcutsList, HeroSearchHint } from "./_shortcuts";

export const metadata = { title: "도움말 — eywa" };

const MENUS: { id: string; label: string; href: string; description: string }[] = [
  {
    id: "dashboard",
    label: "대시보드",
    href: "/",
    description: "오늘의 KPI 4개 (재원생/출석률/수납률/진행 중 상담), 공지사항, 오늘의 일정 타임라인, 최근 7일 출석률·수납률 추세.",
  },
  {
    id: "timetable",
    label: "시간표",
    href: "/timetable",
    description: "주간 반복 시간표 (월~토). 과목별 색상 구분, 강의실과 학생 수 표시.",
  },
  {
    id: "attendance",
    label: "출석부",
    href: "/attendance",
    description: "날짜별 반 그룹으로 출석 현황. 5가지 상태: 출석/결석/지각/공결/보강.",
  },
  {
    id: "classes",
    label: "수업목록",
    href: "/classes",
    description: "운영 중인 반 카드. 담임, 강의실, 정원 진행바와 함께 표시.",
  },
  {
    id: "students",
    label: "학생목록",
    href: "/students",
    description: "학년별 정렬된 학생 테이블. 상세에서 30일 출결 통계 + 수강 중인 반.",
  },
  {
    id: "enrollment",
    label: "등록상담",
    href: "/enrollment",
    description: "신입생 파이프라인 (대기 → 상담완료 → AI 분석 → 등록). Claude AI 진단, A4 인쇄 양식.",
  },
  {
    id: "consultations",
    label: "학생상담",
    href: "/consultations",
    description: "재원생 면담 기록. 요약 + 후속 액션 (긴급도 자동 분류).",
  },
  {
    id: "withdrawals",
    label: "퇴원관리",
    href: "/withdrawals",
    description: "퇴원 학생 목록 + 사유 통계 진행바 + AI 인사이트.",
  },
  {
    id: "staff",
    label: "직원관리",
    href: "/staff",
    description: "원장/관리자/강사 등 역할별 직원. 강사 카드에 담당 반·학생 수 표시.",
  },
  {
    id: "billing",
    label: "수납관리",
    href: "/billing",
    description: "이번 달 청구서 + 미수금. 진행률 스트립 + 기한 경과 일괄 처리.",
  },
  {
    id: "meetings",
    label: "회의록",
    href: "/meetings",
    description: "음성 녹음을 올리면 자동 전사(AssemblyAI) + AI 분석(Claude).",
  },
  {
    id: "help",
    label: "도움말",
    href: "/help",
    description: "지금 보고 있는 페이지.",
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "권한이 어떻게 작동하나요?",
    a: "역할별 메뉴 가시성은 lib/permissions.ts의 매트릭스로 정의됩니다. 사이드바는 자동으로 숨기고, 각 페이지는 서버에서 requireAccess(menu)로 재확인합니다. 데이터 격리는 Supabase RLS가 처리합니다.",
  },
  {
    q: "AI 분석은 어떤 모델을 쓰나요?",
    a: "Claude Sonnet 4.6 (balanced tier)를 기본으로 사용합니다. 분석 결과는 consultation_ai_analysis 테이블에 (consultation_id, model_version) UNIQUE로 저장되며, 인쇄용 print_payload는 jsonb 스냅샷으로 동결됩니다 — 모델을 바꿔도 이미 인쇄된 인수인계서는 변하지 않습니다.",
  },
  {
    q: "데모 데이터는 어떻게 다시 채우나요?",
    a: "pnpm db:seed를 실행합니다. ijw-demo 테넌트의 학생/반/출석/상담/공지를 모두 지우고 다시 만듭니다 (idempotent). master 사용자는 보존됩니다.",
  },
  {
    q: "퇴원 학생이 있는데 학년에 동명이인을 새로 등록할 수 있나요?",
    a: "네. students의 자연키 인덱스는 status<>'withdrawn'인 학생끼리만 적용됩니다. 퇴원생 동명이인은 허용, 활성 중복은 차단.",
  },
  {
    q: "같은 학생을 같은 반에 두 번 등록하면?",
    a: "차단됩니다. enrollments의 GiST EXCLUDE 제약이 (student_id, class_id, daterange) 겹침을 DB 레벨에서 막습니다.",
  },
];

export default async function HelpPage() {
  await requireAccess("help");

  return (
    <div className="space-y-6">
      {/* Search hero */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-[#2a7a52] p-8 text-white shadow-primary-deep">
        <svg
          className="pointer-events-none absolute top-0 right-0 opacity-[0.18]"
          width="240"
          height="240"
          viewBox="0 0 240 240"
          aria-hidden="true"
        >
          {[100, 80, 60, 40, 20].map((r) => (
            <circle key={r} cx="120" cy="120" r={r} fill="none" stroke="#fff" strokeWidth="1" />
          ))}
        </svg>
        <div className="relative max-w-2xl">
          <p className="font-mono text-[11px] tracking-wider uppercase text-[#e9c876]">
            HELP CENTER
          </p>
          <h1 className="mt-2 text-[28px] font-extrabold leading-tight">
            무엇을 도와드릴까요?
          </h1>
          <p className="mt-2 text-[13px] text-white/85">
            12개 메뉴 가이드와 자주 묻는 질문, 단축키를 한 곳에 모았어요.
          </p>
          <div className="mt-5 flex items-center gap-2 rounded-full bg-white/15 px-4 py-2.5 backdrop-blur-sm">
            <EyIcon name="search" size={15} />
            <input
              type="text"
              placeholder="검색어를 입력하세요 (예: 출석 입력, AI 분석)"
              className="flex-1 bg-transparent text-[13px] text-white placeholder:text-white/60 focus:outline-none"
              disabled
            />
            <HeroSearchHint />
          </div>
        </div>
      </section>

      {/* 메뉴 가이드 */}
      <section>
        <header className="mb-3">
          <p className="micro">12개 메뉴 가이드</p>
          <h2 className="text-foreground mt-0.5 text-[17px] font-bold">기능 한눈에 보기</h2>
        </header>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {MENUS.map((m) => {
            const iconName: EywaIconName = MENU_ICON[m.id] ?? "spore";
            return (
              <article
                key={m.href}
                className="bg-card border-line shadow-card rounded-2xl border p-4"
              >
                <header className="flex items-center gap-2">
                  <span className="bg-primary-soft text-primary inline-flex size-7 items-center justify-center rounded-md">
                    <EyIcon name={iconName} size={14} />
                  </span>
                  <h3 className="text-foreground text-[13px] font-bold">{m.label}</h3>
                  <span className="text-text-faint ml-auto font-mono text-[10px]">{m.href}</span>
                </header>
                <p className="text-text-dim mt-2 text-[12px] leading-relaxed">{m.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      {/* FAQ */}
      <section>
        <header className="mb-3">
          <p className="micro">FAQ</p>
          <h2 className="text-foreground mt-0.5 text-[17px] font-bold">자주 묻는 질문</h2>
        </header>
        <div className="bg-card border-line divide-line shadow-card divide-y rounded-2xl border">
          {FAQ.map((item) => (
            <details key={item.q} className="group px-5 py-4">
              <summary className="text-foreground flex cursor-pointer items-center justify-between text-[13px] font-bold">
                <span>{item.q}</span>
                <span className="text-text-dim ml-2 text-lg transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="text-text-dim mt-3 text-[12px] leading-relaxed">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* 단축키 + 문의 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="bg-card border-line shadow-card rounded-2xl border p-5">
          <header className="mb-3">
            <p className="micro">단축키</p>
            <h2 className="text-foreground mt-0.5 text-[15px] font-bold">키보드 한 번에</h2>
          </header>
          <ShortcutsList />
        </section>

        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-[#185533] p-5 text-white shadow-primary-glow">
          <p className="font-mono text-[10px] tracking-wider uppercase text-[#e9c876]">
            1:1 문의
          </p>
          <h3 className="mt-1.5 text-[17px] font-extrabold leading-tight">
            도움이 필요하시면 언제든
          </h3>
          <p className="mt-2 text-[12px] text-white/85">
            평일 10:00–18:00 · 1670-0000
          </p>
          <button
            type="button"
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-white px-3.5 py-2 text-[12px] font-bold text-primary"
          >
            <EyIcon name="arrowRight" size={12} />
            상담 예약하기
          </button>
        </section>
      </div>
    </div>
  );
}
