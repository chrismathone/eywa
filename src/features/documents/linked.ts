// 데이터베이스(서식 저장소) "연동 폴더" — 다른 운영 테이블의 문서형 데이터(교재 요청서·수강료 견적서)를
// 읽기 전용 링크 행으로 노출한다. 원본 단일 소스 유지: 행은 각 테이블(textbook_orders·tuition_quotes)이
// 소유하고(이중 저장 금지 — makeedu 동기화 충돌 방지), 탐색기는 목록·검색·열기(딥링크)만 제공.
// "전체 문서"에는 섞지 않는다(대량 링크 행이 서식 목록을 도배하는 것 방지) — 전용 폴더에서만.
// 새 연동 소스 추가 = 여기 등록 + server/linked-queries.ts에 조회 분기. ⚠️ server-only 금지 [[#61]].

import { schoolGradeLabel } from "@/lib/format/school-grade";

export const LINKED_SOURCES = [
  { key: "textbooks", label: "교재 요청서" },
  { key: "quotes", label: "수강료 견적서" },
] as const;
export type LinkedSourceKey = (typeof LINKED_SOURCES)[number]["key"];

export const LINKED_LABEL: Record<LinkedSourceKey, string> = {
  textbooks: "교재 요청서",
  quotes: "수강료 견적서",
};

export function isLinkedSource(v: string): v is LinkedSourceKey {
  return LINKED_SOURCES.some((s) => s.key === v);
}

/** 탐색기 테이블이 렌더하는 링크 행 — DocumentRow와 같은 컬럼 구성(읽기 전용, 고정/삭제 없음). */
export type LinkedDocRow = {
  id: string;
  title: string;
  description: string | null;
  categoryLabel: string; // 분류 컬럼(원본 위치 안내)
  typeLabel: string; // 유형 컬럼
  createdAt: string; // 등록일 컬럼(ISO/date)
  byName: string | null; // 등록자 컬럼(요청 강사·상담자)
  href: string; // 이름 클릭 목적지(교재=인쇄 카드, 견적=계산기 딥링크)
  printId: string | null; // 있으면 usePrintWindow(A4 인쇄 창)로 연다 — 없으면 일반 창(WindowLink)
};

const KRW = new Intl.NumberFormat("ko-KR");
const won = (n: number) => `${KRW.format(n)}원`;

// 교재 진행 라벨 — 하단 체크(등록·납부·주문) 기준. 3체크 전부면 완료, 아니면 첫 미완 단계 "대기".
function textbookProgressLabel(o: { registered: boolean; paid: boolean; ordered: boolean }): string {
  if (o.registered && o.paid && o.ordered) return "완료";
  if (!o.registered) return "등록 대기";
  if (!o.paid) return "납부 대기";
  return "주문 대기";
}

/** textbook_orders 행 → 링크 행. 클릭 = 교재 요청서 인쇄 카드(/textbook/[id]/print). */
export function textbookOrderDoc(o: {
  id: string;
  bookName: string;
  bookDetail: string | null;
  studentName: string | null;
  teacherName: string | null;
  price: number;
  registered: boolean;
  paid: boolean;
  ordered: boolean;
  requestDate: string | null;
  createdAt: string;
}): LinkedDocRow {
  return {
    id: o.id,
    title: `${o.studentName ?? "학생 미지정"} — ${o.bookName}`,
    description:
      [o.bookDetail, won(o.price), textbookProgressLabel(o)]
        .filter(Boolean)
        .join(" · ") || null,
    categoryLabel: "수납·결제",
    typeLabel: "교재 요청서",
    createdAt: o.requestDate ?? o.createdAt,
    byName: o.teacherName,
    href: `/textbook/${o.id}/print`,
    printId: `print/textbook/${o.id}`,
  };
}

/** tuition_quotes 행 → 링크 행. 클릭 = 수강료 계산기에 견적 로드(?qid=). */
export function quoteDoc(qt: {
  id: string;
  studentName: string;
  school: string | null;
  grade: string | null;
  courseCount: number;
  totalAmount: number;
  consultant: string | null;
  createdAt: string;
}): LinkedDocRow {
  const sg = schoolGradeLabel(qt.school, qt.grade);
  return {
    id: qt.id,
    title: `${qt.studentName} — 수강료 견적서`,
    description:
      [sg || null, qt.courseCount > 0 ? `과목 ${qt.courseCount}` : null, won(qt.totalAmount)]
        .filter(Boolean)
        .join(" · ") || null,
    categoryLabel: "수납·결제",
    typeLabel: "수강료 견적서",
    createdAt: qt.createdAt,
    byName: qt.consultant,
    href: `/billing?tab=calculator&qid=${qt.id}`,
    printId: null,
  };
}
