/**
 * Aywa icon system — product objects and familiar interface actions.
 *
 * 사용: `<EyIcon name="calendar" size={18} />`.
 * 모든 아이콘은 viewBox 24×24, currentColor, stroke 1.6, round cap/join.
 * 상세 규격: docs/icon-system.md
 */
import type { SVGProps } from "react";
import type { MenuKey } from "@/lib/permissions";

export const AYWA_ICON_SIZES = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;

export type AywaIconFamily = "product" | "interface";

type AywaIconDefinition = {
  name: string;
  label: string;
  family: AywaIconFamily;
  meaning: string;
};

/** 아이콘 갤러리·문서가 함께 읽는 단일 카탈로그. 새 아이콘은 렌더러와 여기에 같이 등록한다. */
export const AYWA_ICON_CATALOG = [
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
  { name: "sheetColumns", label: "열 시트", family: "interface", meaning: "세로 열로 나뉜 표" },
  { name: "sheetRows", label: "행 시트", family: "interface", meaning: "가로 행으로 나뉜 표" },
  // 뜻이 다른데 그림이 같던 자리를 가른 것들(2026-09-08) — 짝은 아래 MENU_ICON 주석 참조.
  { name: "seatGrid", label: "자리 배치", family: "interface", meaning: "자리 여섯 칸 중 하나가 다른 색" },
  { name: "weekGrid", label: "주간 격자", family: "interface", meaning: "세로·가로 격자에 수업 블록 하나" },
  { name: "star", label: "별", family: "interface", meaning: "평가·점수" },
  { name: "tablet", label: "태블릿", family: "interface", meaning: "세로 화면 기기" },
  { name: "formInput", label: "입력 양식", family: "interface", meaning: "칸 두 개짜리 폼" },
  { name: "invoice", label: "청구서", family: "interface", meaning: "금액이 적힌 종이" },
  { name: "steering", label: "운전대", family: "interface", meaning: "운행" },
  { name: "busStop", label: "정류장", family: "interface", meaning: "기둥 위 표지판" },
  { name: "square", label: "사각형", family: "interface", meaning: "창과 선택 영역" },
  { name: "arrowLeft", label: "왼쪽 화살표", family: "interface", meaning: "이전 위치로 이동" },
  { name: "calculator", label: "계산기", family: "interface", meaning: "금액과 수치 계산" },
  { name: "stop", label: "중지", family: "interface", meaning: "진행 중인 작업 종료" },
  { name: "pause", label: "일시정지", family: "interface", meaning: "멈췄다가 이어서 하기" },
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
  { name: "hand", label: "손", family: "interface", meaning: "약속과 맡은 할 일" },
  { name: "gauge", label: "점수 계기판", family: "interface", meaning: "평가 점수와 그 기준" },
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
  { name: "flask", label: "실험실", family: "interface", meaning: "시험 중인 실험실 기능 표시" },
] as const satisfies readonly AywaIconDefinition[];

export type AywaIconName = (typeof AYWA_ICON_CATALOG)[number]["name"];

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
      <circle cx="8" cy="7" r="3" />
      <path d="M3 20v-3q0-4 5-4q2 0 3 2" />
      <circle cx="17" cy="13" r="2" />
      <path d="M13 21q0-3 4-3q4 0 4 3" />
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
      <circle cx="8" cy="7" r="3" />
      <path d="M3 20v-3q0-4 5-4q2 0 3 2" />
      <line x1="13" y1="17" x2="21" y2="17" />
      <line x1="17" y1="13" x2="17" y2="21" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4M17 3v4" />
      <line x1="6" y1="10" x2="18" y2="10" />
      <circle cx="12" cy="15" r="2" />
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
      <circle cx="8" cy="7" r="3" />
      <path d="M3 20v-3q0-4 5-4q2 0 3 2" />
      <line x1="13" y1="17" x2="21" y2="17" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M4 7l12-4v4" />
      <path d="M21 11h-5q-2 0-2 2v1q0 2 2 2h5" />
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
      <path d="M3.5 15C4.8 18.5 8 21 12 21c5 0 9-4 9-9c0-5-4-9-9-9C8.5 3 5.5 5 4 8" />
      <polyline points="4,3 4,8 9,8" />
      <polyline points="12,7 12,12 15,15" />
    </>
  ),
  undo: (
    <>
      <polyline points="7,5 3,9 7,13" />
      <path d="M3 9h9c5 0 9 4 9 9" />
      <line x1="21" y1="18" x2="21" y2="21" />
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
      <path d="M9 5H8q-2 0-2 2v12q0 2 2 2h8q2 0 2-2V7q0-2-2-2h-1" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <line x1="9" y1="11" x2="15" y2="11" />
      <line x1="9" y1="16" x2="15" y2="16" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="7" x2="12" y2="12" />
      <line x1="12" y1="12" x2="15" y2="15" />
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
      <polyline points="3,9 12,4 21,9 12,14 3,9" />
      <path d="M6 11v6q6 4 12 0v-6" />
      <line x1="21" y1="9" x2="21" y2="17" />
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
      <path d="M9 5H6q-2 0-2 2v12q0 2 2 2h12q2 0 2-2V7q0-2-2-2h-3" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <polyline points="8,13 11,16 16,11" />
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
      <path d="M3 21V9q0-2 2-2h10q2 0 2 2v6q0 2-2 2H7Z" />
      <path d="M8 3h11q2 0 2 2" />
      <line x1="21" y1="5" x2="21" y2="12" />
      <line x1="7" y1="12" x2="13" y2="12" />
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
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M6 9h12M6 14h12" />
      <line x1="11" y1="7" x2="11" y2="17" />
    </>
  ),
  // 강사 시트 형제 — 같은 틀, 선의 **방향**만 다르다(영어=요일 열 / 수학=학생 행).
  // 🔴 이 둘의 구분선은 세트의 '안쪽 여백' 관례와 달리 **테두리까지 닿는다**: 띄우면 표가 아니라 떠 있는
  //    획으로 읽히고, 특히 열 갈래는 20px에서 한글 자모 'ㅠ'로 보였다([[#12]] 계열).
  sheetColumns: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </>
  ),
  sheetRows: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
    </>
  ),
  seatGrid: (
    <>
      <rect x="3" y="5" width="5" height="5" rx="1" />
      <rect x="9.5" y="5" width="5" height="5" rx="1" />
      <rect x="16" y="5" width="5" height="5" rx="1" />
      <rect x="3" y="14" width="5" height="5" rx="1" />
      <rect x="9.5" y="14" width="5" height="5" rx="1" />
      <rect x="16" y="14" width="5" height="5" rx="1" />
    </>
  ),
  weekGrid: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="9" x2="9" y2="21" />
      <line x1="15" y1="9" x2="15" y2="21" />
    </>
  ),
  star: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" />,
  tablet: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="2" />
      <line x1="12" y1="18" x2="12" y2="18" />
    </>
  ),
  formInput: (
    <>
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
      <line x1="6.5" y1="7" x2="12" y2="7" />
      <line x1="6.5" y1="17" x2="12" y2="17" />
    </>
  ),
  invoice: (
    <>
      <path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" />
      <line x1="8.5" y1="8" x2="15.5" y2="8" />
      <line x1="8.5" y1="12" x2="15.5" y2="12" />
    </>
  ),
  steering: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.5" />
      <line x1="12" y1="3.5" x2="12" y2="9.5" />
      <line x1="4.4" y1="16" x2="9.8" y2="13.3" />
      <line x1="19.6" y1="16" x2="14.2" y2="13.3" />
    </>
  ),
  busStop: (
    <>
      <rect x="6" y="3" width="12" height="9" rx="1.5" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <line x1="9" y1="21" x2="15" y2="21" />
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
  pause: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5v7M14 8.5v7" />
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
      <path d="M12 18C9 15 5 12 5 9q0-6 7-6q7 0 7 6c0 3-4 6-7 9Z" />
      <circle cx="12" cy="9" r="2.5" />
      <line x1="9" y1="21" x2="15" y2="21" />
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
      <path d="M8 3h8q2 0 2 2v16l-3-3l-3 3l-3-3l-3 3V5q0-2 2-2Z" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="9" y1="13" x2="15" y2="13" />
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
      <circle cx="8" cy="7" r="3" />
      <path d="M3 20v-3q0-4 5-4q2 0 3 2" />
      <circle cx="17" cy="17" r="2" />
      <path d="M17 13v2M17 19v2M13 17h2M19 17h2" />
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
      <rect x="3" y="4" width="18" height="5" rx="1" />
      <path d="M5 9v10q0 2 2 2h10q2 0 2-2V9" />
      <line x1="10" y1="13" x2="14" y2="13" />
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
      <rect x="4" y="3" width="16" height="16" rx="2" />
      <line x1="4" y1="10" x2="20" y2="10" />
      <path d="M7 19v2M17 19v2" />
      <path d="M7 15h3M14 15h3" />
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
      <path d="M4 14l9-9q1-1 2 0l5 5q1 1 0 2l-8 8H10Z" />
      <line x1="9" y1="9" x2="16" y2="16" />
      <line x1="12" y1="20" x2="21" y2="20" />
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
      <path d="M9 8q0-2 3-2q3 0 3 3q0 2-3 2v2" />
      <circle cx="12" cy="17" r="1" />
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
      <circle cx="7" cy="16" r="4" />
      <line x1="10" y1="13" x2="20" y2="3" />
      <path d="M15 8l3 3M18 5l3 3" />
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
      <rect x="3" y="8" width="5" height="6" rx="1" />
      <polyline points="8,8 18,4 18,18 8,14" />
      <polyline points="5,14 7,21 11,21 9,14" />
      <line x1="21" y1="8" x2="21" y2="14" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3c-5 0-9 4-9 9c0 5 4 9 9 9h2q2 0 2-2q0-1-2-3q-1-2 1-2h3q3 0 3-3c0-5-4-8-9-8Z" />
      <circle cx="7" cy="10" r="1" />
      <circle cx="11" cy="7" r="1" />
      <circle cx="16" cy="8" r="1" />
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
      <path d="M5 4h14q2 0 2 2v9l-6 6H5q-2 0-2-2V6q0-2 2-2Z" />
      <polyline points="15,21 15,15 21,15" />
      <line x1="7" y1="9" x2="16" y2="9" />
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
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <line x1="5" y1="17" x2="19" y2="17" />
      <polyline points="11,3 11,11 14,8 17,11 17,3" />
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
      <path d="M8 3h10q2 0 2 2v13q0 3-3 3H7q-3 0-3-3v-1h10q0 4 3 4" />
      <rect x="3" y="3" width="6" height="4" rx="1" />
      <line x1="9" y1="7" x2="9" y2="17" />
      <line x1="12" y1="9" x2="16" y2="9" />
      <line x1="12" y1="13" x2="16" y2="13" />
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
  gauge: (
    <>
      <path d="M3 17a9 9 0 0 1 18 0" />
      <path d="M12 17l5-6M3 17h18" />
    </>
  ),
  // 약속·할 일(연결 탐색 조각 · 원장 2026-11-05 시안의 손바닥).
  hand: (
    <>
      <path d="M18 11V6a2 2 0 0 0-4 0v5" />
      <path d="M14 10V4a2 2 0 0 0-4 0v6" />
      <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </>
  ),
  listChecks: (
    <>
      <polyline points="3,5 5,7 8,4" />
      <polyline points="3,11 5,13 8,10" />
      <polyline points="3,17 5,19 8,16" />
      <path d="M11 6h10M11 12h10M11 18h10" />
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
      <path d="M6 10q0-6 6-6q6 0 6 6v4l2 3H4l2-3Z" />
      <path d="M10 20q2 2 4 0" />
      <line x1="3" y1="6" x2="5" y2="4" />
      <line x1="19" y1="4" x2="21" y2="6" />
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
      <path d="M11 10l-7 7q-1.5 1.5 0 3q1.5 1.5 3 0l7-7" />
      <path d="M17 3C12 2 9 6 11 10M14 13c4 2 8-1 7-6" />
      <polyline points="17,3 14,6 14,10 18,10 21,7" />
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
  flask: <path d="M9 3h6M10 3v6l-6 10a1.4 1.4 0 0 0 1.2 2h13.6a1.4 1.4 0 0 0 1.2-2L14 9V3M7 15h10" />,
} as const;

type ExtendedIconName = keyof typeof EXTENDED_ICON_GLYPHS;

function isExtendedIconName(name: AywaIconName): name is ExtendedIconName {
  return Object.prototype.hasOwnProperty.call(EXTENDED_ICON_GLYPHS, name);
}

export type AywaIconProps = {
  name: AywaIconName;
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
}: AywaIconProps) {
  // 장식 아이콘은 기본 aria-hidden(텍스트가 의미를 전달). aria-label을 주면 노출.
  const labelled = rest["aria-label"] != null || rest["aria-labelledby"] != null;
  const common: SVGProps<SVGSVGElement> & { "data-aywa-icon": AywaIconName } = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    focusable: "false",
    "data-aywa-icon": name,
    className,
    ...rest,
    role: labelled ? (rest.role ?? "img") : rest.role,
    "aria-hidden": labelled ? undefined : (rest["aria-hidden"] ?? true),
  };

  switch (name) {
    case "screen":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="11" rx="2" />
          <line x1="12" y1="16" x2="12" y2="20" />
          <line x1="8" y1="20" x2="16" y2="20" />
        </svg>
      );
    case "report":
      return (
        <svg {...common}>
          <path d="M7 3h6l6 6v10q0 2-2 2H7q-2 0-2-2V5q0-2 2-2Z" />
          <polyline points="13,3 13,9 19,9" />
          <line x1="9" y1="17" x2="9" y2="13" />
          <line x1="15" y1="17" x2="15" y2="12" />
        </svg>
      );
    case "exam":
      return (
        <svg {...common}>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <polyline points="8,8 10,10 14,6" />
          <line x1="8" y1="14" x2="16" y2="14" />
          <line x1="8" y1="18" x2="12" y2="18" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3L4 6v6q0 5 8 9" />
          <path d="M12 3l8 3v6q0 5-8 9" />
          <polyline points="8,12 11,15 16,10" />
        </svg>
      );
    case "book":
      return (
        <svg {...common}>
          <path d="M12 6Q8 3 3 4v14q5-1 9 2" />
          <path d="M12 6q4-3 9-2v14q-5-1-9 2" />
          <line x1="12" y1="6" x2="12" y2="20" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <rect x="3" y="8" width="18" height="12" rx="2" />
          <path d="M3 8V6q0-2 2-2h4l4 4" />
          <line x1="6" y1="12" x2="18" y2="12" />
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
          <path d="M5 3v4M5 11v10M12 3v10M12 17v4M19 3v4M19 11v10" />
          <circle cx="5" cy="9" r="2" />
          <circle cx="12" cy="15" r="2" />
          <circle cx="19" cy="9" r="2" />
        </svg>
      );
    case "sync":
      return (
        <svg {...common}>
          <path d="M4 7C5.6 4.5 8.6 3 12 3q6 0 9 6M20 17c-1.6 2.5-4.6 4-8 4q-6 0-9-6" />
          <polyline points="16,9 21,9 21,4" />
          <polyline points="3,20 3,15 8,15" />
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
  timetable: "weekGrid",
  attendance: "clipboardCheck",
  makeups: "alarm",
  // 자리(랩실·JJ실) 출석부 — 출석부와 같은 일이지만 축이 '방'이라 공간 기호를 쓴다.
  // 🔴 2026-09-08부터 **뜻이 다르면 그림도 다르다**(원장 "같은 아이콘을 안쓰면 좋겠는데") — 아이콘 공유 선례를 새로 만들지 말 것.
  seat_attendance: "seatGrid",
  classes: "book",
  students: "users",
  // 원생 기여도 — 남은 스티커 중 뜻이 맞는 것이 없어 선화(원형 차트 = 기여의 몫)로 둔다(menu-glyph.test.ts PENDING_GLYPH).
  // 🔴 listChecks는 '출결 모드' 면이 쓴다(2026-10-22 겹침 해소).
  student_contribution: "pieChart",
  student_english_name: "edit",
  teacher_view: "eye",
  exams: "exam",
  enrollment: "userPlus",
  consultations: "messages",
  withdrawals: "userMinus",
  // 퇴원보고서 — report는 수업보고서·영상 제출 현황 몫이다. 퇴원관리(userMinus)와 다른 사람+X 스티커(2026-10-22).
  withdrawal_reports: "userX",
  // 비포클래스체크리스트(초안) — 수업 전 준비 체크. listChecks(출결 모드)·clipboardCheck(출석부)와 다른 선택 상자.
  before_class_checklist: "checkbox",
  retention: "shield",
  // 신규생 관리 — 체크리스트 7항목이 정체성이다(이탈 방어의 "방패"와 뜻이 달라 그림도 다르다).
  newcomers: "userCheck",
  // 🔴 영어·수학 강사 시트는 **수업 업무군에 나란히 서는 버튼 둘**이라 같은 글리프를 쓰면 구분이 안 된다(2026-09-08).
  ecs: "sheetColumns", // English Class Sheet — 주간(요일 열)
  mcs: "sheetRows", // Math Class Sheet — 월간(학생 행 × 수업일)
  lesson_reports: "report",
  staff: "userSettings",
  billing: "wallet",
  textbook_requests: "bookMarked",
  expense_requests: "receipt",
  meetings: "note",
  documents: "folder",
  class_review: "star", // 수업 평가 — 옛 clipboardCheck는 출석부와 같은 그림이라 나란히 서면 구분이 안 됐다
  approvals: "scrollText", // 전자결재 — 결재 문서(두루마리) 정체성
  calendar: "calendar", // 캘린더 — 학원 공용 일정
  shuttle: "bus", // 셔틀(노랑버스) — 노선 편성·등하원 기록
  inventory: "archive", // 재고관리 — 보관·대장 정체성(자산관리대장)
  // 교재목록 — `book`(수업목록)·`bookMarked`(교재 요청)과 **다른 글리프**여야 나란히 섰을 때 갈린다.
  // 차수별 진도가 든 책이라 "내용이 있는 책"(bookText).
  textbooks: "bookText",
  integrations: "sync",
  sheet_sync: "spreadsheet",
  help: "help",
  // 고객센터 — 운영팀에 보내는 문의(봉투 + 말풍선 스티커, codex 2026-09-28). `megaphone`은 학원 설정 '팝업 공지' 면이 쓴다(같은 그림 금지).
  support: "mail",
  admin: "wrench",
  owner: "settings",
  report_settings: "calendarCheck",
  ai_ment: "chart",
  profile_settings: "palette",
  operations_settings: "clock",
  billing_settings: "invoice",
  notification_settings: "bellRing",
  consultation_settings: "formInput",
  navigation_settings: "check",
  integration_settings: "sync",
  popup_settings: "megaphone",
  attendance_salary_settings: "percent",
  payroll_settings: "wallet",
  teacher_onescreen: "screen",
  my_learning: "graduationCap",
  kiosk_settings: "tablet",
  // 연결 앱 권한(메뉴 화면이 아니다) — 사이드바 '연결 앱'의 오늘 수학 줄과 같은 그림(connected-app-rail.tsx).
  app_todays_math: "calculator",
} as const satisfies Record<MenuKey, AywaIconName>;
