import type { AywaIconName } from "@/components/icons/aywa-icons";

/** Public product copy, aligned with current menus. Never include tenant data. */
export const NAV_LINKS = [
  { label: "주요 기능", href: "#features" },
  { label: "함께 쓰는 AYWA", href: "#workspace" },
  { label: "이용 안내", href: "#guide" },
] as const;

export const PRODUCT_FEATURES: { icon: AywaIconName; title: string; description: string; tools: string }[] = [
  { icon: "calendar", title: "수업의 준비부터 기록까지", description: "시간표와 출결을 확인하고, 영어·수학 강사 시트에서 진도와 과제를 관리합니다.", tools: "시간표 · 출석부 · 강사 시트" },
  { icon: "users", title: "학생 한 명의 흐름을 이어서", description: "첫 상담과 등록, 재원 중 상담과 성적을 연결해 학생에게 필요한 관리를 이어갑니다.", tools: "원생목록 · 콜&상담 · 성적관리" },
  { icon: "wallet", title: "수납과 지출을 한곳에서", description: "수강료 청구와 납부 내역을 확인하고, 미납 관리부터 교재와 지출 업무까지 정리합니다.", tools: "수납관리 · 교재 · 지출" },
  { icon: "clipboardCheck", title: "함께 일하는 팀의 업무도", description: "직원 정보와 근무 기록을 관리하고, 회의에서 결정한 일과 결재 문서를 함께 확인합니다.", tools: "직원관리 · 회의록 · 전자결재" },
  { icon: "bus", title: "교실 밖 운영까지 꼼꼼하게", description: "셔틀 노선과 등하원 현황, 학원 자산과 소모품을 각각의 관리 화면에서 살펴봅니다.", tools: "셔틀 · 재고관리" },
  { icon: "sparkle", title: "기록을 읽고, 다음 일을 확인", description: "운영 브리핑과 상담·회의 요약을 참고해 확인할 내용을 정리하고 후속 업무로 이어갑니다.", tools: "운영실 · 상담 분석 · 회의 요약" },
];

export const WORKSPACE_ROLES = [
  { title: "원장과 관리자", description: "운영 현황을 살피고, 필요한 업무 화면을 나란히 열어 확인합니다.", icon: "layoutGrid" },
  { title: "강사", description: "담당 수업과 학생을 중심으로 출결, 진도, 수업 기록을 관리합니다.", icon: "book" },
  { title: "운영 담당자", description: "계정에 부여된 권한과 담당 업무에 맞는 메뉴에서 일합니다.", icon: "userCheck" },
] satisfies { title: string; description: string; icon: AywaIconName }[];

export const ACCESS_STEPS = [
  { title: "도입 문의", description: "도입과 이용 요금은 문의해 주세요. 담당자가 학원 등록과 이용 환경을 함께 안내해 드립니다." },
  { title: "계정 발급", description: "학원 관리자에게 개인 계정과 담당 업무에 맞는 권한을 받습니다." },
  { title: "로그인 후 업무 시작", description: "발급받은 이메일과 비밀번호로 소속 학원의 업무 공간에 접속합니다." },
] as const;

export const ACCESS_FAQ = [
  { question: "계정은 어떻게 발급받나요?", answer: "AYWA는 학원에서 발급한 계정으로 이용합니다. 학원 구성원은 원장 또는 시스템 담당자에게 계정을 요청해 주세요. 새로 이용하려는 학원은 도입을 문의해 주세요." },
  { question: "이용 요금은 어떻게 되나요?", answer: "요금과 도입 조건은 문의해 주시면 담당자가 안내해 드립니다." },
  { question: "로그인할 때 학원을 선택해야 하나요?", answer: "계정에 연결된 소속 학원으로 접속합니다. 로그인 화면에서 학원을 따로 선택하지 않아도 됩니다. 소속이나 접근 권한이 맞지 않으면 학원 관리자에게 확인해 주세요." },
  { question: "비밀번호가 기억나지 않으면 어떻게 하나요?", answer: "학원 관리자에게 비밀번호 재설정을 요청해 주세요. 계정을 발급받은 이메일 주소를 함께 전달하면 계정 확인에 도움이 됩니다." },
  { question: "모든 직원에게 같은 화면이 보이나요?", answer: "역할과 담당 업무, 학원에서 설정한 접근 권한에 따라 보이는 메뉴가 달라집니다. 필요한 메뉴가 보이지 않으면 학원 관리자에게 권한을 확인해 주세요." },
] as const;
