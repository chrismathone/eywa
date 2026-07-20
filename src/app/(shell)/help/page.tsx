import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { requireAccess } from "@/lib/auth/require-access";
import type { MenuKey } from "@/lib/permissions";
import { HelpBrowser } from "./_help-browser";

export const metadata = { title: "도움말 — eywa" };

const QUICKSTART: { title: string; desc: string; href: string; hrefLabel: string }[] = [
  {
    title: "학원 기본 설정하기 (원장)",
    desc: "과목·학년·강의실·교시를 우리 학원에 맞게 먼저 정해두면, 이후 반·학생 등록이 훨씬 수월해요.",
    href: "/owner",
    hrefLabel: "학원 설정",
  },
  {
    title: "반 만들기",
    desc: "수업목록에서 ‘새 반’을 눌러 과목·강사·요일·시각을 정합니다.",
    href: "/classes",
    hrefLabel: "수업목록",
  },
  {
    title: "학생 등록하기",
    desc: "학생목록에서 한 명씩 등록하거나, 엑셀 파일로 여러 명을 한 번에 올릴 수 있어요.",
    href: "/students",
    hrefLabel: "학생목록",
  },
  {
    title: "반에 배정하기",
    desc: "학생 상세의 ‘반 배정’, 또는 시간표에서 학생을 끌어다 원하는 반으로 옮기면 됩니다.",
    href: "/timetable",
    hrefLabel: "시간표",
  },
  {
    title: "매일 운영하기",
    desc: "출석을 체크하고(출석부), 청구·수납을 관리하고(수납관리), 상담·성적을 기록하세요.",
    href: "/attendance",
    hrefLabel: "출석부",
  },
];

const MENUS: { id: MenuKey; label: string; href: string; description: string }[] = [
  {
    id: "dashboard",
    label: "운영실",
    href: "/dashboard",
    description: "Eywa가 우선순위를 정리하는 운영실 — 긴급·승인·오늘 할 일과 수업 흐름을 실행 순서로 봅니다.",
  },
  {
    id: "timetable",
    label: "시간표",
    href: "/timetable",
    description:
      "주간 시간표. 학생을 끌어다 다른 반으로 옮기고, 주를 앞뒤로 넘겨 지난·예정 배치까지 봅니다. 엑셀·구글시트로 내보내 편집한 뒤 다시 가져올 수도 있어요.",
  },
  {
    id: "attendance",
    label: "출석부",
    href: "/attendance",
    description: "학생 × 날짜 격자에서 출결을 체크합니다 — 출석·결석·지각·보강.",
  },
  {
    id: "classes",
    label: "수업목록",
    href: "/classes",
    description: "반을 새로 만들고 수정합니다 — 과목·담임·강의실·색·요일·교시.",
  },
  {
    id: "students",
    label: "학생목록",
    href: "/students",
    description:
      "학생을 등록·검색하고, 상세에서 수강 반·출결·성적·상담 이력을 봅니다. 엑셀로 여러 명을 한 번에 등록할 수도 있어요.",
  },
  {
    id: "exams",
    label: "성적관리",
    href: "/exams",
    description: "시험을 만들고 반별로 점수를 한 번에 입력하면 평균·석차가 자동으로 계산됩니다.",
  },
  {
    id: "enrollment",
    label: "등록상담",
    href: "/enrollment",
    description:
      "신입생 상담을 기록합니다. 직접 입력하거나 상담을 녹음하면 AI가 요약·분석해 폼을 채워줘요. QR로 학부모가 직접 접수하게 할 수도 있습니다.",
  },
  {
    id: "consultations",
    label: "학생상담",
    href: "/consultations",
    description: "재원생 면담 기록. 녹음하면 AI가 학습·정서 케어 포인트를 정리하고, 후속 조치를 챙겨줍니다.",
  },
  {
    id: "retention",
    label: "이탈 방어",
    href: "/retention",
    description: "출결·성적·상담·수납을 종합해 이탈 위험 학생을 자동으로 찾아, ‘오늘 누구부터’ 챙길지 알려줍니다.",
  },
  {
    id: "withdrawals",
    label: "퇴원관리",
    href: "/withdrawals",
    description: "퇴원 처리와 사유 통계. 필요하면 재원 상태로 되돌릴 수 있어요.",
  },
  {
    id: "staff",
    label: "직원관리",
    href: "/staff",
    description: "직원 등록과 역할(원장·관리자·강사 등), 담당 반·학생, 급여·휴가 관리.",
  },
  {
    id: "billing",
    label: "수납관리",
    href: "/billing",
    description: "이번 달 청구서와 미수금, 교재·지출, 신입생 수강료 계산기까지 한곳에서.",
  },
  {
    id: "meetings",
    label: "회의록",
    href: "/meetings",
    description: "회의를 녹음하면 자동으로 글로 옮기고, AI가 안건·결정·할 일로 정리합니다.",
  },
  {
    id: "owner",
    label: "학원 설정",
    href: "/owner",
    description: "(원장 전용) 과목·학년·직급·교시·브랜드 색·강의실·공지를 우리 학원에 맞게 설정합니다.",
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
    q: "처음인데 어디서부터 시작하나요?",
    a: "위 ‘빠른 시작’ 순서대로 하시면 됩니다 — 학원 설정 → 반 만들기 → 학생 등록 → 반 배정 → 매일 운영(출석·수납·상담). 대부분의 화면은 오른쪽 위 ‘새 ○○’ 버튼으로 바로 추가할 수 있어요.",
  },
  {
    q: "메뉴가 창으로 뜨는데 어떻게 쓰나요?",
    a: "메뉴나 이름을 누르면 창으로 열립니다. 여러 개를 동시에 띄워 비교하고, 창을 화면 가장자리로 끌면 나란히 배치돼요. 최소화해도 작업 내용은 그대로 유지됩니다.",
  },
  {
    q: "엑셀·구글시트로 학생이나 시간표를 가져올 수 있나요?",
    a: "네. 학생목록·시간표의 ‘가져오기’를 쓰면 됩니다. 먼저 ‘엑셀’로 내보내 그 형식대로 편집한 뒤 다시 올리면, 무엇이 바뀌는지 미리보기로 보여주고 확인을 받은 다음 반영합니다. 구글시트로 편집했다면 .xlsx로 내려받아 올리면 돼요.",
  },
  {
    q: "상담이나 회의를 녹음하면 어떻게 되나요?",
    a: "녹음하거나 파일을 올리면 자동으로 글로 옮기고(전사), AI가 요약·분석합니다. 다시 분석은 ‘재분석’ 버튼을 누를 때만 실행되니, 화면을 열어보기만 해도 비용이 드는 일은 없어요.",
  },
  {
    q: "권한은 어떻게 정해지나요?",
    a: "역할에 따라 보이는 메뉴가 자동으로 결정됩니다. 접근 권한이 없는 메뉴는 숨겨지고, 각 화면도 열릴 때 서버에서 한 번 더 확인해요. 학원별 데이터는 완전히 분리되어 다른 학원 정보는 절대 보이지 않습니다.",
  },
  {
    q: "AI 분석 결과는 어떻게 저장되나요?",
    a: "AI 요약·분석은 학생·상담·회의별로 저장되고, 인쇄용 문서는 분석한 시점의 내용으로 고정됩니다. 초안으로 참고하되 필요하면 직접 고쳐 쓰실 수 있어요.",
  },
  {
    q: "이름이 같은 학생, 같은 반 중복 등록은 어떻게 되나요?",
    a: "같은 학년에 이름이 같은 학생이라도 한 명이 퇴원 상태면 새로 등록할 수 있습니다(재원 중인 학생끼리만 중복이 차단돼요). 또 같은 학생을 같은 반에 기간이 겹치게 두 번 넣는 것은 자동으로 막혀 있습니다.",
  },
  {
    q: "실수한 건 되돌릴 수 있나요?",
    a: "대부분의 정보는 언제든 수정할 수 있고, 퇴원 처리한 학생도 재원으로 되돌릴 수 있습니다. 영구 삭제처럼 되돌리기 어려운 작업은 실행 전에 한 번 더 확인을 받아요.",
  },
];

export default async function HelpPage() {
  await requireAccess("help");

  return (
    <div className="space-y-6">
      <HelpBrowser quickstart={QUICKSTART} menus={MENUS} faq={FAQ} />

      <section className="border-line bg-card shadow-card flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center">
        <span className="bg-primary-soft text-primary flex size-11 shrink-0 items-center justify-center rounded-lg">
          <EyIcon name="help" size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="editorial-eyebrow">디자인 시스템</p>
          <h2 className="text-foreground mt-0.5 text-[15px] font-bold">Eywa 아이콘 시스템</h2>
          <p className="text-text-dim mt-1 text-[11px] leading-relaxed">
            제품에서 사용하는 아이콘과 크기, 선, 의미 배정 규칙을 한눈에 확인하세요.
          </p>
        </div>
        <Link
          href="/help/icons"
          className="bg-primary text-primary-foreground hover:shadow-primary-glow inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-[12px] font-bold transition-shadow"
        >
          아이콘 보기 <EyIcon name="arrowRight" size={12} />
        </Link>
      </section>

      {/* 1:1 문의 */}
      <div className="lg:max-w-md">
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-[#0d2b52] p-5 text-white shadow-primary-glow">
          <p className="text-[12px] font-bold text-[#e2b45f]">1:1 문의</p>
          <h3 className="mt-1.5 text-[17px] font-bold leading-tight">
            도움이 필요하시면 언제든
          </h3>
          <p className="mt-2 text-[12px] text-white/85">
            평일 10:00–18:00 · 1670-0000
          </p>
          <a
            href="tel:1670-0000"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-[12px] font-bold text-primary"
          >
            <EyIcon name="arrowRight" size={12} />
            상담 예약하기
          </a>
        </section>
      </div>
    </div>
  );
}
