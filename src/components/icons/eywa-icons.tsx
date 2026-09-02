/**
 * Eywa icon system — product objects and familiar interface actions.
 *
 * 사용: `<EyIcon name="calendar" size={18} />`.
 * 모든 아이콘은 viewBox 24×24, currentColor, stroke 1.6, round cap/join.
 * 상세 규격: docs/icon-system.md
 */
import type { SVGProps } from "react";
import type { MenuKey } from "@/lib/permissions";

export const EYWA_ICON_SIZES = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;

export type EywaIconFamily = "product" | "interface";

type EywaIconDefinition = {
  name: string;
  label: string;
  family: EywaIconFamily;
  meaning: string;
};

/** 아이콘 갤러리·문서가 함께 읽는 단일 카탈로그. 새 아이콘은 렌더러와 여기에 같이 등록한다. */
export const EYWA_ICON_CATALOG = [
  { name: "screen", label: "화면", family: "product", meaning: "한 화면에서 마감하는 수업" },
  { name: "report", label: "보고서", family: "product", meaning: "정리되어 전달되는 기록" },
  { name: "exam", label: "시험지", family: "product", meaning: "평가와 확인된 결과" },
  { name: "shield", label: "보호", family: "product", meaning: "이탈을 막는 선제적 관리" },
  { name: "book", label: "책", family: "product", meaning: "교재와 학습 자료" },
  { name: "folder", label: "폴더", family: "product", meaning: "문서와 서식의 저장소" },
  { name: "building", label: "학원", family: "product", meaning: "학원 설정과 조직" },
  { name: "settings", label: "설정", family: "product", meaning: "관리 도구와 환경 조정" },
  { name: "sync", label: "동기화", family: "product", meaning: "외부 서비스와 데이터 연결" },
  { name: "search", label: "검색", family: "interface", meaning: "대상 찾기" },
  { name: "bell", label: "알림", family: "interface", meaning: "확인이 필요한 소식" },
  { name: "arrowUp", label: "위 화살표", family: "interface", meaning: "올리기와 이전 방향" },
  { name: "arrowDown", label: "아래 화살표", family: "interface", meaning: "내리기와 다음 방향" },
  { name: "arrowRight", label: "오른쪽 화살표", family: "interface", meaning: "이동과 다음 단계" },
  { name: "play", label: "재생", family: "interface", meaning: "시작과 실행" },
  { name: "check", label: "확인", family: "interface", meaning: "완료와 성공" },
  { name: "plus", label: "추가", family: "interface", meaning: "새 항목 만들기" },
  { name: "dot", label: "점", family: "interface", meaning: "현재 상태와 작은 표식" },
  { name: "sparkle", label: "반짝임", family: "interface", meaning: "AI가 만든 결과와 자동화" },
  { name: "close", label: "닫기", family: "interface", meaning: "창과 레이어 닫기" },
  { name: "chevronDown", label: "아래 펼침", family: "interface", meaning: "목록 펼치기와 아래 이동" },
  { name: "chevronUp", label: "위 접힘", family: "interface", meaning: "목록 접기와 위 이동" },
  { name: "chevronRight", label: "오른쪽 펼침", family: "interface", meaning: "하위 메뉴와 다음 단계" },
  { name: "menu", label: "메뉴", family: "interface", meaning: "내비게이션 열기" },
  { name: "panelLeft", label: "왼쪽 패널", family: "interface", meaning: "사이드바 열기와 접기" },
  { name: "eye", label: "보기", family: "interface", meaning: "숨겨진 내용 표시" },
  { name: "eyeOff", label: "보기 해제", family: "interface", meaning: "민감한 내용 숨기기" },
  { name: "success", label: "성공", family: "interface", meaning: "작업의 성공 상태" },
  { name: "info", label: "안내", family: "interface", meaning: "참고할 정보와 안내" },
  { name: "alert", label: "주의", family: "interface", meaning: "주의가 필요한 상태" },
  { name: "error", label: "오류", family: "interface", meaning: "실패와 중단 상태" },
  { name: "loader", label: "처리 중", family: "interface", meaning: "진행 중인 비동기 작업" },
  { name: "trash", label: "삭제", family: "interface", meaning: "항목 삭제와 폐기" },
  { name: "edit", label: "편집", family: "interface", meaning: "내용 수정과 작성" },
  { name: "save", label: "저장", family: "interface", meaning: "변경 내용 보존" },
  { name: "users", label: "사용자 그룹", family: "interface", meaning: "여러 사람과 구성원" },
  { name: "mic", label: "마이크", family: "interface", meaning: "음성 입력과 녹음" },
  { name: "externalLink", label: "외부 링크", family: "interface", meaning: "새 위치로 이동" },
  { name: "printer", label: "인쇄", family: "interface", meaning: "문서 출력" },
  { name: "userPlus", label: "사용자 추가", family: "interface", meaning: "새 구성원 등록" },
  { name: "calendar", label: "달력", family: "interface", meaning: "날짜와 일정" },
  { name: "upload", label: "업로드", family: "interface", meaning: "파일과 데이터 올리기" },
  { name: "chevronLeft", label: "왼쪽 펼침", family: "interface", meaning: "이전 메뉴와 왼쪽 이동" },
  { name: "userMinus", label: "사용자 제외", family: "interface", meaning: "구성원 제거와 해제" },
  { name: "wallet", label: "지갑", family: "interface", meaning: "수납과 결제 수단" },
  { name: "download", label: "다운로드", family: "interface", meaning: "파일과 데이터 내려받기" },
  { name: "history", label: "변경 이력", family: "interface", meaning: "과거 기록과 복원 지점" },
  { name: "undo", label: "되돌리기", family: "interface", meaning: "직전 변경 취소" },
  { name: "userCheck", label: "사용자 확인", family: "interface", meaning: "구성원 승인과 확인" },
  { name: "clipboardList", label: "목록 보드", family: "interface", meaning: "작성할 항목과 작업 목록" },
  { name: "clock", label: "시계", family: "interface", meaning: "시간과 마감" },
  { name: "copy", label: "복사", family: "interface", meaning: "항목과 값 복제" },
  { name: "graduationCap", label: "학습", family: "interface", meaning: "교육 과정과 수료" },
  { name: "user", label: "사용자", family: "interface", meaning: "개별 사람과 계정" },
  { name: "currency", label: "금액", family: "interface", meaning: "비용과 통화" },
  { name: "clipboardCheck", label: "검수 완료", family: "interface", meaning: "확인된 목록과 점검" },
  { name: "layoutGrid", label: "격자 보기", family: "interface", meaning: "카드와 열 배치" },
  { name: "list", label: "목록 보기", family: "interface", meaning: "행 중심 목록 배치" },
  { name: "message", label: "메시지", family: "interface", meaning: "단일 대화와 의견" },
  { name: "messages", label: "대화 목록", family: "interface", meaning: "여러 대화와 상담" },
  { name: "pin", label: "고정", family: "interface", meaning: "위치와 항목 고정" },
  { name: "spreadsheet", label: "표 문서", family: "interface", meaning: "행과 열 데이터" },
  { name: "square", label: "사각형", family: "interface", meaning: "창과 선택 영역" },
  { name: "arrowLeft", label: "왼쪽 화살표", family: "interface", meaning: "이전 위치로 이동" },
  { name: "calculator", label: "계산기", family: "interface", meaning: "금액과 수치 계산" },
  { name: "stop", label: "중지", family: "interface", meaning: "진행 중인 작업 종료" },
  { name: "layers", label: "레이어", family: "interface", meaning: "겹친 창과 단계" },
  { name: "logOut", label: "나가기", family: "interface", meaning: "세션과 공간에서 나가기" },
  { name: "mapPin", label: "위치", family: "interface", meaning: "주소와 장소" },
  { name: "minus", label: "빼기", family: "interface", meaning: "수량 감소와 제거" },
  { name: "qrCode", label: "QR 코드", family: "interface", meaning: "스캔 가능한 연결 정보" },
  { name: "receipt", label: "영수증", family: "interface", meaning: "결제와 청구 기록" },
  { name: "searchOff", label: "검색 결과 없음", family: "interface", meaning: "검색할 수 없거나 비어 있음" },
  { name: "shieldCheck", label: "보호 확인", family: "interface", meaning: "검증된 보안 상태" },
  { name: "tag", label: "태그", family: "interface", meaning: "분류와 라벨" },
  { name: "userSettings", label: "사용자 설정", family: "interface", meaning: "계정 권한과 구성" },
  { name: "window", label: "창", family: "interface", meaning: "앱 창과 화면 영역" },
  { name: "archive", label: "보관함", family: "interface", meaning: "완료 항목 보관" },
  { name: "swap", label: "교환", family: "interface", meaning: "양방향 이동과 변경" },
  { name: "percent", label: "백분율", family: "interface", meaning: "비율과 할인" },
  { name: "chart", label: "차트", family: "interface", meaning: "통계와 분포" },
  { name: "bus", label: "차량", family: "interface", meaning: "운행과 이동 수단" },
  { name: "cake", label: "생일", family: "interface", meaning: "생일과 기념일" },
  { name: "checkbox", label: "선택 상자", family: "interface", meaning: "복수 선택과 완료 표시" },
  { name: "circle", label: "원", family: "interface", meaning: "단일 선택과 상태 윤곽" },
  { name: "droplet", label: "물방울", family: "interface", meaning: "색과 액체 상태" },
  { name: "eraser", label: "지우개", family: "interface", meaning: "입력과 표시 제거" },
  { name: "file", label: "파일", family: "interface", meaning: "일반 문서와 첨부" },
  { name: "image", label: "이미지", family: "interface", meaning: "사진과 시각 자료" },
  { name: "filter", label: "필터", family: "interface", meaning: "조건으로 결과 좁히기" },
  { name: "merge", label: "병합", family: "interface", meaning: "흐름과 데이터 합치기" },
  { name: "globe", label: "지구", family: "interface", meaning: "언어와 외부 네트워크" },
  { name: "grip", label: "이동 손잡이", family: "interface", meaning: "끌어서 순서 변경" },
  { name: "hash", label: "번호", family: "interface", meaning: "식별 번호와 순번" },
  { name: "help", label: "도움말", family: "interface", meaning: "추가 설명과 지원" },
  { name: "home", label: "홈", family: "interface", meaning: "기본 위치와 시작 화면" },
  { name: "key", label: "열쇠", family: "interface", meaning: "접근 키와 인증" },
  { name: "languages", label: "언어", family: "interface", meaning: "번역과 언어 선택" },
  { name: "lock", label: "잠금", family: "interface", meaning: "제한된 접근과 보호" },
  { name: "logIn", label: "들어가기", family: "interface", meaning: "세션과 공간에 입장" },
  { name: "mail", label: "메일", family: "interface", meaning: "전자 우편과 연락" },
  { name: "megaphone", label: "공지", family: "interface", meaning: "여러 사람에게 알림" },
  { name: "palette", label: "색상", family: "interface", meaning: "테마와 표현 색 선택" },
  { name: "panelLeftClose", label: "사이드바 접기", family: "interface", meaning: "왼쪽 패널 축소" },
  { name: "panelLeftOpen", label: "사이드바 펼치기", family: "interface", meaning: "왼쪽 패널 확장" },
  { name: "paperclip", label: "첨부", family: "interface", meaning: "파일과 자료 연결" },
  { name: "power", label: "전원", family: "interface", meaning: "기능 켜기와 끄기" },
  { name: "scissors", label: "자르기", family: "interface", meaning: "범위 분리와 잘라내기" },
  { name: "send", label: "보내기", family: "interface", meaning: "메시지와 데이터 전송" },
  { name: "note", label: "메모", family: "interface", meaning: "짧은 기록과 주석" },
  { name: "target", label: "목표", family: "interface", meaning: "달성 지점과 집중 대상" },
  { name: "trendingDown", label: "하락 추세", family: "interface", meaning: "감소와 낮아지는 흐름" },
  { name: "alertCircle", label: "원형 경고", family: "interface", meaning: "입력 오류와 주의 상태" },
  { name: "calendarClock", label: "예약 일정", family: "interface", meaning: "날짜가 정해진 시간 약속" },
  { name: "calendarOff", label: "일정 해제", family: "interface", meaning: "취소되거나 사용할 수 없는 날짜" },
  { name: "calendarCheck", label: "일정 확인", family: "interface", meaning: "확정되고 완료된 일정" },
  { name: "bookText", label: "교재 내용", family: "interface", meaning: "글이 담긴 학습 자료" },
  { name: "bookMarked", label: "교재 표시", family: "interface", meaning: "저장하거나 지정한 학습 자료" },
  { name: "bookPlus", label: "교재 추가", family: "interface", meaning: "새 학습 자료 등록" },
  { name: "messageOff", label: "메시지 해제", family: "interface", meaning: "메시지 중지와 비활성" },
  { name: "messagePlus", label: "메시지 추가", family: "interface", meaning: "새 대화와 메시지 작성" },
  { name: "columns2", label: "두 열", family: "interface", meaning: "두 영역 나란히 배치" },
  { name: "columns3", label: "세 열", family: "interface", meaning: "세 영역 나란히 배치" },
  { name: "filePlus", label: "파일 추가", family: "interface", meaning: "새 파일과 문서 생성" },
  { name: "files", label: "여러 파일", family: "interface", meaning: "복수 문서와 자료 묶음" },
  { name: "cloudUpload", label: "클라우드 업로드", family: "interface", meaning: "외부 저장소로 데이터 전송" },
  { name: "scrollText", label: "긴 문서", family: "interface", meaning: "이어지는 본문과 기록" },
  { name: "userX", label: "사용자 차단", family: "interface", meaning: "구성원 접근 중단" },
  { name: "banknote", label: "지폐", family: "interface", meaning: "현금과 금액 지불" },
  { name: "fileDownload", label: "파일 다운로드", family: "interface", meaning: "특정 문서 내려받기" },
  { name: "alarm", label: "알람", family: "interface", meaning: "지정 시간 알림" },
  { name: "copyPlus", label: "복사본 추가", family: "interface", meaning: "복제해 새 항목 만들기" },
  { name: "listChecks", label: "완료 목록", family: "interface", meaning: "여러 작업의 점검 상태" },
  { name: "pinOff", label: "고정 해제", family: "interface", meaning: "고정된 위치와 항목 풀기" },
  { name: "doorOpen", label: "열린 문", family: "interface", meaning: "공간 출입과 열린 상태" },
  { name: "percentBadge", label: "할인 배지", family: "interface", meaning: "할인율과 비율 혜택" },
  { name: "barChart", label: "막대 차트", family: "interface", meaning: "항목별 수치 비교" },
  { name: "pieChart", label: "원형 차트", family: "interface", meaning: "전체에서 차지하는 비율" },
  { name: "bellRing", label: "울리는 알림", family: "interface", meaning: "새로 도착한 적극적 알림" },
  { name: "imageDownload", label: "이미지 다운로드", family: "interface", meaning: "사진과 시각 자료 내려받기" },
  { name: "filterList", label: "목록 필터", family: "interface", meaning: "목록 조건과 정렬 범위" },
  { name: "folderOpen", label: "열린 폴더", family: "interface", meaning: "현재 탐색 중인 저장소" },
  { name: "wrench", label: "도구", family: "interface", meaning: "유지보수와 세부 조정" },
  { name: "panelTop", label: "상단 패널", family: "interface", meaning: "위쪽 영역이 나뉜 레이아웃" },
  { name: "tags", label: "여러 태그", family: "interface", meaning: "복수 분류와 라벨 묶음" },
] as const satisfies readonly EywaIconDefinition[];

export type EywaIconName = (typeof EYWA_ICON_CATALOG)[number]["name"];

/** 반복되는 보편 조작을 위한 정적 SVG 조각. 공통 viewBox와 선 규칙은 EyIcon이 적용한다. */
const EXTENDED_ICON_GLYPHS = {
  trash: (
    <>
      <path d="M4 7h16M9 3h6l1 4H8zM7 7l1 14h8l1-14" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20l4.2-1 10.4-10.4-3.2-3.2L5 15.8z" />
      <path d="M13.8 7l3.2 3.2" />
    </>
  ),
  save: (
    <>
      <path d="M4 3h13l3 3v15H4z" />
      <path d="M8 3v6h8V3M8 21v-7h8v7" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20c0-4 2-6 5.5-6s5.5 2 5.5 6" />
      <path d="M15 5.5a3 3 0 010 5.5M16 14c2.8.4 4.5 2.4 4.5 5" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0012 0M12 17v4M9 21h6" />
    </>
  ),
  externalLink: (
    <>
      <path d="M13 4h7v7M20 4l-9 9" />
      <path d="M18 14v6H4V6h6" />
    </>
  ),
  printer: (
    <>
      <path d="M7 8V3h10v5M7 17H4V9h16v8h-3" />
      <rect x="7" y="14" width="10" height="7" rx="1" />
      <path d="M17 11h1" />
    </>
  ),
  userPlus: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20c0-4 2-6 5.5-6 2.5 0 4.2 1 5 3" />
      <path d="M18 12v7M14.5 15.5h7" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4M17 3v4M3 10h18" />
      <path d="M8 14h1M12 14h1M16 14h1M8 17h1M12 17h1" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 15v6h16v-6" />
    </>
  ),
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  userMinus: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20c0-4 2-6 5.5-6 2.5 0 4.2 1 5 3" />
      <path d="M15 15.5h7" />
    </>
  ),
  wallet: (
    <>
      <path d="M4 6h15a2 2 0 012 2v11H4zM4 6l12-3v3" />
      <path d="M16 11h5v5h-5a2.5 2.5 0 010-5z" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v12M7 11l5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  history: (
    <>
      <path d="M4 8V3M4 8h5" />
      <path d="M5 8a8.5 8.5 0 11-1 7" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  undo: (
    <>
      <path d="M9 8L4 12l5 4" />
      <path d="M5 12h8a6 6 0 016 6" />
    </>
  ),
  userCheck: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20c0-4 2-6 5.5-6 2.5 0 4.2 1 5 3" />
      <path d="M15 16l2 2 4-5" />
    </>
  ),
  clipboardList: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V2h6v2M9 9h6M9 13h6M9 17h4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l4 2" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V4H4v12h4" />
    </>
  ),
  graduationCap: (
    <>
      <path d="M2 9l10-5 10 5-10 5z" />
      <path d="M6 11v5c3 3 9 3 12 0v-5M22 9v7" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-5 3-7 8-7s8 2 8 7" />
    </>
  ),
  currency: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5c-.8-1-2-1.5-3.5-1.5-2 0-3.5 1-3.5 2.5 0 3.8 7 1.2 7 5 0 1.5-1.5 2.5-3.5 2.5-1.6 0-3-.6-3.8-1.7M12 5v14" />
    </>
  ),
  clipboardCheck: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V2h6v2M8 13l3 3 5-6" />
    </>
  ),
  layoutGrid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4 6h1M4 12h1M4 18h1" />
    </>
  ),
  message: (
    <>
      <path d="M4 4h16v13H9l-5 4z" />
      <path d="M8 9h8M8 13h5" />
    </>
  ),
  messages: (
    <>
      <path d="M5 5h14v10H9l-4 4z" />
      <path d="M8 2h13v10l-2 2M9 9h6" />
    </>
  ),
  pin: (
    <>
      <path d="M8 3h8l-1 6 4 4H5l4-4z" />
      <path d="M12 13v8" />
    </>
  ),
  spreadsheet: (
    <>
      <path d="M5 2h10l4 4v16H5zM15 2v5h4" />
      <path d="M8 11h8M8 15h8M8 19h8M11 9v12" />
    </>
  ),
  square: <rect x="4" y="4" width="16" height="16" rx="1.5" />,
  arrowLeft: (
    <>
      <path d="M19 12H5" />
      <path d="M11 6l-6 6 6 6" />
    </>
  ),
  calculator: (
    <>
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M8 6h8v4H8zM8 14h1M12 14h1M16 14h1M8 18h1M12 18h1M16 18h1" />
    </>
  ),
  stop: (
    <>
      <circle cx="12" cy="12" r="9" />
      <rect x="9" y="9" width="6" height="6" rx="0.5" />
    </>
  ),
  layers: (
    <>
      <path d="M3 8l9-5 9 5-9 5z" />
      <path d="M4 12l8 5 8-5M4 16l8 5 8-5" />
    </>
  ),
  logOut: (
    <>
      <path d="M10 4H4v16h6M14 8l4 4-4 4M18 12H8" />
    </>
  ),
  mapPin: (
    <>
      <path d="M12 22s7-6 7-13a7 7 0 00-14 0c0 7 7 13 7 13z" />
      <circle cx="12" cy="9" r="2.5" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  qrCode: (
    <>
      <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3z" />
      <path d="M14 14h3v3h-3zM18 18h3v3h-3zM18 13h3M13 19v2" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3h12v19l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  searchOff: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.5-4.5M4 4l14 14" />
    </>
  ),
  shieldCheck: (
    <>
      <path d="M12 2l8 3v6c0 5-3 8-8 11-5-3-8-6-8-11V5z" />
      <path d="M8 12l3 3 5-6" />
    </>
  ),
  tag: (
    <>
      <path d="M3 4h8l10 10-7 7L4 11z" />
      <circle cx="8" cy="8" r="1.2" />
    </>
  ),
  userSettings: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M3 19c0-3.5 1.8-5.5 5-5.5 1.5 0 2.7.4 3.5 1.2" />
      <circle cx="17" cy="16" r="2.5" />
      <path d="M17 11.5v2M17 18.5v2M12.5 16h2M19.5 16h2" />
    </>
  ),
  window: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M7 6.5h.1M10 6.5h.1" />
    </>
  ),
  archive: (
    <>
      <path d="M4 8h16v13H4zM3 3h18v5H3z" />
      <path d="M9 12h6" />
    </>
  ),
  swap: (
    <>
      <path d="M4 8h14M14 4l4 4-4 4" />
      <path d="M20 16H6M10 12l-4 4 4 4" />
    </>
  ),
  percent: (
    <>
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="17" cy="17" r="2.5" />
      <path d="M19 5L5 19" />
    </>
  ),
  chart: (
    <>
      <path d="M4 21V4M4 21h17" />
      <path d="M8 17v-4M12 17V8M16 17v-7M20 17V5" />
    </>
  ),
  bus: (
    <>
      <rect x="5" y="3" width="14" height="16" rx="3" />
      <path d="M5 10h14M8 19v2M16 19v2M8 15h.1M16 15h.1" />
    </>
  ),
  cake: (
    <>
      <path d="M5 11h14v10H5zM4 15h16" />
      <path d="M8 11V8M12 11V7M16 11V8" />
      <path d="M8 5c1-1 1-2 0-3M12 4c1-1 1-2 0-3M16 5c1-1 1-2 0-3" />
    </>
  ),
  checkbox: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 12l3 3 6-7" />
    </>
  ),
  circle: <circle cx="12" cy="12" r="9" />,
  droplet: <path d="M12 2s7 8 7 13a7 7 0 01-14 0c0-5 7-13 7-13z" />,
  eraser: (
    <>
      <path d="M4 15l9-10 7 7-8 9H7z" />
      <path d="M9 10l7 7M12 21h9" />
    </>
  ),
  file: (
    <>
      <path d="M6 2h8l4 4v16H6z" />
      <path d="M14 2v5h4" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M4 18l5-5 3 3 3-4 5 6" />
    </>
  ),
  filter: (
    <>
      <path d="M3 5h18l-7 8v6l-4 2v-8z" />
    </>
  ),
  merge: (
    <>
      <circle cx="6" cy="4" r="2" />
      <circle cx="18" cy="4" r="2" />
      <circle cx="12" cy="20" r="2" />
      <path d="M6 6v3c0 4 6 3 6 9M18 6v3c0 4-6 3-6 9" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3 4 6 4 9s-1 6-4 9M12 3c-3 3-4 6-4 9s1 6 4 9" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  hash: <path d="M9 3L7 21M17 3l-2 18M4 9h16M3 15h16" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.8 2.8 0 115 1.7c-1.5 1.3-2.5 1.6-2.5 3.3" />
      <circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),
  home: (
    <>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v11h14V10M9 21v-7h6v7" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M16 7l3 3M14 9l2 2" />
    </>
  ),
  languages: (
    <>
      <path d="M3 5h10M8 3v2c0 5-2 8-5 10M5 9c1 2 3 4 6 5" />
      <path d="M14 21l4-10 4 10M15.5 17h5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 018 0v3M12 14v3" />
    </>
  ),
  logIn: (
    <>
      <path d="M14 4h6v16h-6M10 8l4 4-4 4M14 12H4" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M4 7l8 6 8-6" />
    </>
  ),
  megaphone: (
    <>
      <path d="M4 10v5h4l10 4V6L8 10z" />
      <path d="M8 15l2 6h4l-2-5M21 9v7" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 00-9 9c0 5 4 9 9 9h1.5a2 2 0 001.2-3.6l-.7-.5a1.5 1.5 0 01.9-2.7H18a3 3 0 003-3C21 6.5 17 3 12 3z" />
      <circle cx="8" cy="9" r="1" /><circle cx="12" cy="7" r="1" /><circle cx="16" cy="9" r="1" />
    </>
  ),
  panelLeftClose: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M9 3v18M16 8l-4 4 4 4" />
    </>
  ),
  panelLeftOpen: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M9 3v18M13 8l4 4-4 4" />
    </>
  ),
  paperclip: <path d="M8 12l7-7a4 4 0 015.5 5.5l-9 9a6 6 0 01-8.5-8.5l9-9M7 16l9-9" />,
  power: (
    <>
      <path d="M12 2v10" />
      <path d="M7 5a9 9 0 1010 0" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6" cy="7" r="3" />
      <circle cx="6" cy="17" r="3" />
      <path d="M8.5 8.5L20 20M8.5 15.5L20 4" />
    </>
  ),
  send: <path d="M3 4l18 8-18 8 4-8zM7 12h14" />,
  note: (
    <>
      <path d="M5 3h14v14l-4 4H5z" />
      <path d="M15 21v-4h4M8 8h8M8 12h6" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  trendingDown: (
    <>
      <path d="M4 6l6 6 4-4 6 7" />
      <path d="M15 15h5v-5" />
    </>
  ),
  alertCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6" />
      <circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),
  calendarClock: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4M17 3v4M3 10h18" />
      <circle cx="15" cy="16" r="3" />
      <path d="M15 14.5V16l1 1" />
    </>
  ),
  calendarOff: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4M17 3v4M3 10h18M4 4l16 17" />
    </>
  ),
  calendarCheck: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4M17 3v4M3 10h18M7 16l3 3 6-6" />
    </>
  ),
  bookText: (
    <>
      <path d="M4 4c3-1 5 0 8 2v15c-3-2-5-2-8-1zM20 4c-3-1-5 0-8 2v15c3-2 5-2 8-1z" />
      <path d="M7 9h2M7 13h2M15 9h2M15 13h2" />
    </>
  ),
  bookMarked: (
    <>
      <path d="M5 3h14v18H7a2 2 0 01-2-2zM5 17h14" />
      <path d="M13 3v8l2-1.5 2 1.5V3" />
    </>
  ),
  bookPlus: (
    <>
      <path d="M4 4c3-1 5 0 8 2v15c-3-2-5-2-8-1zM20 4c-3-1-5 0-8 2v15c3-2 5-2 8-1z" />
      <path d="M16 8v6M13 11h6" />
    </>
  ),
  messageOff: (
    <>
      <path d="M4 4h16v13H9l-5 4z" />
      <path d="M3 3l18 18" />
    </>
  ),
  messagePlus: (
    <>
      <path d="M4 4h16v13H9l-5 4z" />
      <path d="M12 8v6M9 11h6" />
    </>
  ),
  columns2: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </>
  ),
  columns3: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M15 4v16" />
    </>
  ),
  filePlus: (
    <>
      <path d="M6 2h8l4 4v16H6zM14 2v5h4" />
      <path d="M12 11v7M8.5 14.5h7" />
    </>
  ),
  files: (
    <>
      <path d="M8 2h8l4 4v14H8zM16 2v5h4" />
      <path d="M8 5H4v17h12v-2" />
    </>
  ),
  cloudUpload: (
    <>
      <path d="M7 18H5a4 4 0 010-8 7 7 0 0113-2 5 5 0 011 10h-2" />
      <path d="M12 20V10M8 14l4-4 4 4" />
    </>
  ),
  scrollText: (
    <>
      <path d="M7 3h12v16a3 3 0 01-3 3H7a3 3 0 01-3-3h12" />
      <path d="M7 3a3 3 0 013 3v13M12 8h4M12 12h4M12 16h3" />
    </>
  ),
  userX: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20c0-4 2-6 5.5-6 2.5 0 4.2 1 5 3" />
      <path d="M16 13l5 5M21 13l-5 5" />
    </>
  ),
  banknote: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M7 9H6v1M17 15h1v-1" />
    </>
  ),
  fileDownload: (
    <>
      <path d="M6 2h8l4 4v16H6zM14 2v5h4" />
      <path d="M12 10v8M9 15l3 3 3-3" />
    </>
  ),
  alarm: (
    <>
      <circle cx="12" cy="13" r="7" />
      <path d="M12 9v4l3 2M5 4L2.5 7M19 4l2.5 3M7 20l-2 2M17 20l2 2" />
    </>
  ),
  copyPlus: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V4H4v12h4M14 11v6M11 14h6" />
    </>
  ),
  listChecks: (
    <>
      <path d="M10 6h10M10 12h10M10 18h10" />
      <path d="M3 6l2 2 3-4M3 12l2 2 3-4M3 18l2 2 3-4" />
    </>
  ),
  pinOff: (
    <>
      <path d="M8 3h8l-1 6 4 4H5l4-4zM12 13v8M3 3l18 18" />
    </>
  ),
  doorOpen: (
    <>
      <path d="M5 21V3h12v18M5 21h15" />
      <path d="M9 5l8-2v18l-8-2zM13 12h.1" />
    </>
  ),
  percentBadge: (
    <>
      <path d="M12 2l3 2 4-.2.2 4 2.8 3-2 3 .2 4-4 .2-3 2-3-2-4 .2-.2-4-2.8-3 2-3-.2-4 4-.2z" />
      <circle cx="9" cy="9" r="1.5" />
      <circle cx="15" cy="15" r="1.5" />
      <path d="M16 8L8 16" />
    </>
  ),
  barChart: (
    <>
      <path d="M4 21V4M4 21h17" />
      <rect x="7" y="13" width="3" height="5" rx="0.5" />
      <rect x="12" y="8" width="3" height="10" rx="0.5" />
      <rect x="17" y="5" width="3" height="13" rx="0.5" />
    </>
  ),
  pieChart: (
    <>
      <path d="M12 3a9 9 0 109 9h-9z" />
      <path d="M15 3.5A9 9 0 0120.5 9H15z" />
    </>
  ),
  bellRing: (
    <>
      <path d="M6 9a6 6 0 0112 0v4l2 3H4l2-3V9zM10 19a2 2 0 004 0" />
      <path d="M4 8a8 8 0 012-4M20 8a8 8 0 00-2-4" />
    </>
  ),
  imageDownload: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8" cy="9" r="1.5" />
      <path d="M4 18l5-5 3 3M16 10v7M13 14l3 3 3-3" />
    </>
  ),
  filterList: (
    <>
      <path d="M4 6h16M7 12h13M10 18h10" />
      <path d="M4 4v4M7 10v4M10 16v4" />
    </>
  ),
  folderOpen: (
    <>
      <path d="M3 7h7l2 2h8l1 4H7l-3 7z" />
      <path d="M7 13h14l-3 7H4" />
    </>
  ),
  wrench: (
    <>
      <path d="M14 6a5 5 0 006 6L11 21l-4-4 9-9a5 5 0 00-6-6l3 3-3 3-3-3" />
      <circle cx="8.5" cy="19.5" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),
  panelTop: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M7 6h.1M10 6h.1" />
    </>
  ),
  tags: (
    <>
      <path d="M3 4h7l9 9-6 6-9-9z" />
      <path d="M10 4h3l8 8-6 6M7 8h.1" />
    </>
  ),
} as const;

type ExtendedIconName = keyof typeof EXTENDED_ICON_GLYPHS;

function isExtendedIconName(name: EywaIconName): name is ExtendedIconName {
  return Object.prototype.hasOwnProperty.call(EXTENDED_ICON_GLYPHS, name);
}

export type EywaIconProps = {
  name: EywaIconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
} & Omit<SVGProps<SVGSVGElement>, "name">;

export function EyIcon({
  name,
  size = 18,
  strokeWidth = 1.8,
  className,
  ...rest
}: EywaIconProps) {
  // 장식 아이콘은 기본 aria-hidden(텍스트가 의미를 전달). aria-label을 주면 노출.
  const labelled = rest["aria-label"] != null || rest["aria-labelledby"] != null;
  const common: SVGProps<SVGSVGElement> & { "data-eywa-icon": EywaIconName } = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    focusable: "false",
    "data-eywa-icon": name,
    className,
    ...rest,
    role: labelled ? (rest.role ?? "img") : rest.role,
    "aria-hidden": labelled ? undefined : (rest["aria-hidden"] ?? true),
  };

  switch (name) {
    case "screen":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="13" rx="2" />
          <path d="M8 21h8M12 17v4" />
          <path d="M12 14V9m0 2c-2 0-3-1-3-3 2 0 3 1 3 3zm0 1c0-2 1-3 3-3 0 2-1 3-3 3z" />
        </svg>
      );
    case "report":
      return (
        <svg {...common}>
          <path d="M6 2h8l4 4v16H6z" />
          <path d="M14 2v5h4M9 12h6M9 16h6" />
          <path d="M9 8h1" />
        </svg>
      );
    case "exam":
      return (
        <svg {...common}>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M8 9l2 2 4-4M8 15h8M8 18h5" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 2l8 3v6c0 5-3 8-8 11-5-3-8-6-8-11V5z" />
          <path d="M12 17v-6m0 2c-2.2 0-3.5-1.2-3.5-3.5 2.3 0 3.5 1.2 3.5 3.5zm0 1c0-2.2 1.2-3.5 3.5-3.5 0 2.3-1.2 3.5-3.5 3.5z" />
        </svg>
      );
    case "book":
      return (
        <svg {...common}>
          <path d="M4 4c3-1 5 0 8 2v15c-3-2-5-2-8-1z" />
          <path d="M20 4c-3-1-5 0-8 2v15c3-2 5-2 8-1z" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M3 6h7l2 2h9v11H3z" />
          <path d="M3 10h18" />
        </svg>
      );
    case "building":
      return (
        <svg {...common}>
          <path d="M5 21V5l7-3 7 3v16M3 21h18" />
          <path d="M9 8h1M14 8h1M9 12h1M14 12h1M10 21v-5h4v5" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
        </svg>
      );
    case "sync":
      return (
        <svg {...common}>
          <path d="M20 7h-5V2" />
          <path d="M19 7a8 8 0 00-14-1M4 17h5v5" />
          <path d="M5 17a8 8 0 0014 1" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.5-4.5" />
        </svg>
      );
    case "close":
      return (
        <svg {...common}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      );
    case "chevronDown":
      return (
        <svg {...common}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      );
    case "chevronUp":
      return (
        <svg {...common}>
          <path d="M6 15l6-6 6 6" />
        </svg>
      );
    case "chevronRight":
      return (
        <svg {...common}>
          <path d="M9 6l6 6-6 6" />
        </svg>
      );
    case "menu":
      return (
        <svg {...common}>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      );
    case "panelLeft":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2.5" />
          <path d="M9 3v18" />
        </svg>
      );
    case "eye":
      return (
        <svg {...common}>
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12z" />
          <circle cx="12" cy="12" r="2.8" />
        </svg>
      );
    case "eyeOff":
      return (
        <svg {...common}>
          <path d="M3 3l18 18" />
          <path d="M10.6 6.2A9.7 9.7 0 0112 6c6 0 9.5 6 9.5 6a16 16 0 01-2.3 3.2M6.2 6.2A16 16 0 002.5 12s3.5 6 9.5 6a9.7 9.7 0 003.2-.5" />
          <path d="M10 10a2.8 2.8 0 004 4" />
        </svg>
      );
    case "success":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M7.5 12l3 3 6-6" />
        </svg>
      );
    case "info":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 10v6" />
          <circle cx="12" cy="7" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common}>
          <path d="M12 3L2.8 20h18.4z" />
          <path d="M12 9v5" />
          <circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      );
    case "error":
      return (
        <svg {...common}>
          <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z" />
          <path d="M9 9l6 6M15 9l-6 6" />
        </svg>
      );
    case "loader":
      return (
        <svg {...common}>
          <path d="M21 12a9 9 0 11-2.6-6.4" />
          <path d="M18.4 2.8v2.8h-2.8" />
        </svg>
      );
    case "bell":
      return (
        <svg {...common}>
          <path d="M6 9a6 6 0 0112 0v4l2 3H4l2-3V9z" />
          <path d="M10 19a2 2 0 004 0" />
        </svg>
      );
    case "arrowUp":
      return (
        <svg {...common}>
          <path d="M7 11l5-5 5 5" />
          <path d="M12 6v14" />
        </svg>
      );
    case "arrowDown":
      return (
        <svg {...common}>
          <path d="M7 13l5 5 5-5" />
          <path d="M12 18V4" />
        </svg>
      );
    case "arrowRight":
      return (
        <svg {...common}>
          <path d="M5 12h14" />
          <path d="M13 6l6 6-6 6" />
        </svg>
      );
    case "play":
      return (
        <svg {...common}>
          <path d="M6 4l14 8-14 8V4z" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="M4 12l5 5L20 6" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "dot":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
        </svg>
      );
    case "sparkle":
      return (
        <svg {...common}>
          <path d="M12 3l1.8 5.6L19 10l-5.2 1.4L12 17l-1.8-5.6L5 10l5.2-1.4L12 3z" />
        </svg>
      );
  }

  if (isExtendedIconName(name)) {
    return <svg {...common}>{EXTENDED_ICON_GLYPHS[name]}</svg>;
  }

  name satisfies never;
  return null;
}

// ─────────────────────────── 메뉴 → 아이콘 매핑 ───────────────────────────
// 메뉴 아이콘의 단일 소스. 메인 내비게이션은 기능이 즉시 읽히는 보편 기호를 우선한다.
// 식물·자연물 모티프를 쓰지 않고, 메뉴 기능을 자의적인 비유로 치환하지 않는다.
export const MENU_ICON = {
  dashboard: "layoutGrid",
  timetable: "calendar",
  attendance: "clipboardCheck",
  // 자리(랩실·JJ실) 출석부 — 출석부와 같은 일이지만 축이 '방'이라 공간 기호를 쓴다(아이콘 공유 선례: class_review).
  seat_attendance: "layoutGrid",
  classes: "book",
  students: "users",
  exams: "exam",
  enrollment: "userPlus",
  consultations: "messages",
  withdrawals: "userMinus",
  retention: "shield",
  ecs: "spreadsheet", // English Class Sheet — 시트 이식 정체성(sheet_sync와 아이콘 공유 허용 선례: owner/kiosk=settings)
  mcs: "spreadsheet", // Math Class Sheet — ECS와 같은 성격(시트)이라 같은 글리프를 쓴다
  lesson_reports: "report",
  staff: "userSettings",
  billing: "wallet",
  textbook_requests: "bookMarked",
  expense_requests: "receipt",
  meetings: "note",
  documents: "folder",
  class_review: "clipboardCheck", // 수업 평가 체크리스트 — 점검 정체성(출석부와 공유, ecs 선례)
  approvals: "scrollText", // 전자결재 — 결재 문서(두루마리) 정체성
  calendar: "calendar", // 캘린더 — 학원 공용 일정
  shuttle: "bus", // 셔틀(노랑버스) — 노선 편성·등하원 기록
  inventory: "archive", // 재고 관리 — 보관·대장 정체성(자산관리대장)
  integrations: "sync",
  sheet_sync: "spreadsheet",
  help: "help",
  admin: "wrench",
  owner: "settings",
  teacher_onescreen: "screen",
  my_learning: "graduationCap",
  kiosk_settings: "settings",
} as const satisfies Record<MenuKey, EywaIconName>;
