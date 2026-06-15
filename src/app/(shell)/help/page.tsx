import { EyIcon } from "@/components/icons/eywa-icons";
import { requireAccess } from "@/lib/auth/require-access";
import { HelpBrowser } from "./_help-browser";

export const metadata = { title: "도움말 — eywa" };

const MENUS: { id: string; label: string; href: string; description: string }[] = [
  {
    id: "dashboard",
    label: "대시보드",
    href: "/dashboard",
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
    id: "retention",
    label: "이탈 방어",
    href: "/retention",
    description: "위험도 기반 이탈 방어. 출결·성적·상담·수납에서 위험 학생을 자동 산출 → '오늘 누구부터' 액션 큐 + 리텐션 보드 + 학부모 메시지 초안.",
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
    a: "역할에 따라 보이는 메뉴가 자동으로 결정됩니다. 접근할 수 없는 메뉴는 사이드바에서 숨겨지고, 각 페이지도 열릴 때 서버에서 권한을 한 번 더 확인합니다. 학원별 데이터는 서로 완전히 격리되어 다른 학원 정보는 절대 노출되지 않습니다.",
  },
  {
    q: "AI 분석은 어떤 모델을 쓰나요?",
    a: "Claude AI를 기본으로 사용합니다. 분석 결과는 학생·상담별로 저장되며, 인쇄용 인수인계서는 분석한 시점의 내용으로 고정됩니다 — 모델이 바뀌어도 이미 인쇄한 문서의 내용은 변하지 않습니다.",
  },
  {
    q: "데모 데이터는 어떻게 다시 채우나요?",
    a: "데이터 시드 명령으로 다시 채울 수 있습니다. 데모 학원의 학생·반·출석·상담·공지를 모두 지우고 새로 만듭니다 (여러 번 실행해도 안전). 원장·관리자 계정은 보존됩니다.",
  },
  {
    q: "퇴원 학생이 있는데 학년에 동명이인을 새로 등록할 수 있나요?",
    a: "네. 같은 학년에 이름이 같은 학생이라도 한 명이 퇴원 상태면 새로 등록할 수 있습니다. 재원 중인 학생끼리만 중복 등록이 차단됩니다.",
  },
  {
    q: "같은 학생을 같은 반에 두 번 등록하면?",
    a: "차단됩니다. 같은 학생을 같은 반에 기간이 겹치게 중복 등록하는 것은 시스템 차원에서 막혀 있습니다.",
  },
];

export default async function HelpPage() {
  await requireAccess("help");

  return (
    <div className="space-y-6">
      <HelpBrowser menus={MENUS} faq={FAQ} />

      {/* 1:1 문의 */}
      <div className="lg:max-w-md">
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
          <a
            href="tel:1670-0000"
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-white px-3.5 py-2 text-[12px] font-bold text-primary"
          >
            <EyIcon name="arrowRight" size={12} />
            상담 예약하기
          </a>
        </section>
      </div>
    </div>
  );
}
