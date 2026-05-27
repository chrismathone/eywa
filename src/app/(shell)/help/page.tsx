import {
  BadgeCheck,
  BookOpen,
  Calendar,
  ClipboardCheck,
  HelpCircle,
  LayoutDashboard,
  MessagesSquare,
  NotebookPen,
  UserMinus,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";

export const metadata = { title: "도움말 — eywa" };

const MENUS: { icon: LucideIcon; label: string; href: string; description: string }[] = [
  {
    icon: LayoutDashboard,
    label: "대시보드",
    href: "/",
    description: "오늘의 KPI 4개 (재원생 / 출석률 / 수납률 / 진행 중 상담), 핀 가능한 공지사항, 오늘의 일정 타임라인, 최근 7일 출석률·수납률 추세.",
  },
  {
    icon: Calendar,
    label: "시간표",
    href: "/timetable",
    description: "주간 반복 시간표 (월~토). 과목별 색상 구분, 강의실과 학생 수 표시. 일정 그 자체는 class_schedules 테이블의 weekly recurrence pattern.",
  },
  {
    icon: ClipboardCheck,
    label: "출석부",
    href: "/attendance",
    description: "날짜별 반 그룹으로 출석 현황. 자동으로 최근 가용 날짜로 리다이렉트. 상태: 출석/결석/지각/공결/보강.",
  },
  {
    icon: BookOpen,
    label: "수업목록",
    href: "/classes",
    description: "운영 중인 반 카드. 담임, 강의실, 활성 enrollment 학생 수.",
  },
  {
    icon: Users,
    label: "학생목록",
    href: "/students",
    description: "학년별 정렬된 학생 테이블. 상세에서 30일 출결 통계 + 수강 중인 반.",
  },
  {
    icon: UserPlus,
    label: "등록상담",
    href: "/enrollment",
    description: "신입생 파이프라인 (대기 → 상담완료 → AI 분석 → 등록). 신규 입력 폼, Claude AI 진단, A4 인쇄 양식 (담임 인수인계용).",
  },
  {
    icon: MessagesSquare,
    label: "학생상담",
    href: "/consultations",
    description: "재원생 면담 기록. 요약 + 후속 액션. 학생 이름 클릭하면 학생 상세로.",
  },
  {
    icon: UserMinus,
    label: "퇴원관리",
    href: "/withdrawals",
    description: "퇴원 학생 목록 + 사유 통계. 직전 수강 반과 함께 표시.",
  },
  {
    icon: BadgeCheck,
    label: "직원관리",
    href: "/staff",
    description: "원장/관리자/강사 등 역할별 직원. 담당 반 수, 담임으로 배정된 학생 수.",
  },
  {
    icon: Wallet,
    label: "수납관리",
    href: "/billing",
    description: "이번 달 청구서 + 미수금. 요약 4카드 (총 청구액 / 수납 완료 / 미수금 / 수납률) + 청구서 테이블.",
  },
  {
    icon: NotebookPen,
    label: "회의록",
    href: "/meetings",
    description: "강사 회의, 운영 회의 기록. 참석자 + 본문 (multi-paragraph).",
  },
  {
    icon: HelpCircle,
    label: "도움말",
    href: "/help",
    description: "지금 보고 있는 페이지.",
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "권한이 어떻게 작동하나요?",
    a: "역할별 메뉴 가시성은 lib/permissions.ts의 매트릭스로 정의됩니다. 사이드바는 자동으로 숨기고, 각 페이지는 서버에서 requireAccess(menu)로 재확인합니다. 데이터 격리는 Supabase RLS가 처리합니다 — 사용자의 tenant_id를 통과하는 행만 보입니다.",
  },
  {
    q: "AI 분석은 어떤 모델을 쓰나요?",
    a: "Claude Opus 4.7 (claude-opus-4-7). ANTHROPIC_API_KEY가 설정되어 있으면 실제 호출, 없으면 stub fallback. 분석 결과는 consultation_ai_analysis 테이블에 (consultation_id, model_version) UNIQUE로 저장되며, 인쇄용 print_payload는 jsonb 스냅샷으로 동결됩니다 — 모델을 바꿔도 이미 인쇄된 인수인계서는 변하지 않습니다.",
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
    <div className="space-y-8">
      <PageHeader
        title="도움말"
        description="12개 메뉴 가이드 + FAQ. 기능별 자세한 사용법은 운영 노트에서."
      />

      <section className="space-y-3">
        <h2 className="eyebrow">메뉴 가이드</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {MENUS.map((m) => {
            const Icon = m.icon;
            return (
              <article key={m.href} className="bg-card border-border rounded-lg border p-4">
                <header className="flex items-center gap-2">
                  <span className="bg-muted text-muted-foreground inline-flex size-7 items-center justify-center rounded-md">
                    <Icon className="size-3.5" />
                  </span>
                  <h3 className="text-foreground text-sm font-semibold">{m.label}</h3>
                  <span className="text-muted-foreground num ml-auto font-mono text-[10px]">
                    {m.href}
                  </span>
                </header>
                <p className="text-muted-foreground mt-2 text-xs leading-relaxed">{m.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="eyebrow">자주 묻는 질문</h2>
        <div className="bg-card border-border divide-border divide-y rounded-lg border">
          {FAQ.map((item) => (
            <details key={item.q} className="group px-5 py-4">
              <summary className="text-foreground flex cursor-pointer items-center justify-between text-sm font-medium">
                <span>{item.q}</span>
                <span className="text-muted-foreground ml-2 text-xs transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="eyebrow">데이터 소스</h2>
        <div className="bg-card border-border rounded-lg border p-5 text-sm">
          <p className="text-muted-foreground">
            모든 페이지의 숫자는 Supabase Postgres의 실제 행입니다. RLS가 현재 사용자의 테넌트만 통과시키며, 데모 시드는 가상의 인재원(<span className="num">ijw-demo</span>) 테넌트 안에서만 작동합니다. 외부 시스템과의 연동은 아직 없습니다.
          </p>
        </div>
      </section>
    </div>
  );
}
