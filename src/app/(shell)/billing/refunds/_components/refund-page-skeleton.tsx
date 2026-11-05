import { BackLink } from "@/components/back-link";
import { ToolbarSkeletonItem } from "@/components/toolbar";
import { APPROVAL_SLOTS, REFUND_METHODS } from "@/features/billing/refund-request";

// 투명 글자 막대 — 글자 크기·줄 높이를 실물과 같게 잡는다(칸 높이를 손으로 적지 않게).
const TEXT_BAR = "bg-bg-soft text-transparent animate-pulse rounded";
// 서식 표·칸 — `refund-sheet.tsx`의 T·cell·head와 같은 글자 크기·여백(클라이언트 파일이라 값을 가져올 수 없어 옮겨 적었다).
// 실물은 12px 임의값(종이 허용 목록)이지만 스켈레톤은 토큰으로 — 종이(`paper-scale`) 안의 `text-xs`가 12px이다.
const T = "w-full border-collapse text-xs leading-relaxed";
const CELL = "border-line border px-2 py-1.5 align-middle";
// 편집 모드 입력칸 — `inputBase`의 세로 여백(py-0.5)만큼 줄이 높아진다.
const INPUT = "block rounded-sm bg-bg-soft/40 px-1.5 py-0.5";

/**
 * `lines` = 편집 모드 textarea rows · `viewLines` = 보기 모드에서 흔한 줄 수(값 길이를 따라 늘어나는 칸) ·
 * `editNote` = 편집 모드에서도 입력칸이 아니라 안내 글만 서는 칸(서버가 자동 기록하는 '완료 처리자').
 */
type Row = { label: string; lines?: number; viewLines?: number; editNote?: string };

/** 한 칸 값 자리 — 보기 = 글 줄 · 편집 = 입력칸(여러 줄 칸은 textarea rows만큼) · 안내 칸은 글 한 줄. */
function Value({ editing, lines = 1, viewLines = 1, editNote }: { editing: boolean; lines?: number; viewLines?: number; editNote?: string }) {
  if (editing && editNote) return <span className={TEXT_BAR}>{editNote}</span>;
  const bars = Array.from({ length: editing ? lines : viewLines }, (_, i) => (
    <span key={i} className="block">
      <span className={TEXT_BAR}>값</span>
    </span>
  ));
  return editing ? <span className={INPUT}>{bars}</span> : <>{bars}</>;
}

/** 왼쪽 묶음 머리(rowSpan) + 항목 머리 + 값 — 학생 정보·처리결과 표가 이 모양이다(환불내역은 아래 `RefundTable`). */
function GroupTable({ group, rows, editing }: { group: string; rows: Row[]; editing: boolean }) {
  return (
    <table className={`${T} mt-4`}>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.label}>
            {i === 0 ? (
              <th rowSpan={rows.length} className={`${CELL} w-20`}>
                <span className={TEXT_BAR}>{group}</span>
              </th>
            ) : null}
            <th className={`${CELL} w-28 whitespace-nowrap`}>
              <span className={TEXT_BAR}>{row.label}</span>
            </th>
            <td className={CELL}>
              <Value editing={editing} lines={row.lines} viewLines={row.viewLines} editNote={row.editNote} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// 줄 수·여러 줄 칸(textarea rows)은 `refund-sheet.tsx`와 같다. 보기 모드의 결제내역은 자동입력 기본(최근 3개월)이 흔히 3줄쯤이다.
const STUDENT: Row[] = [
  { label: "이 름" }, { label: "학교/학년" }, { label: "주소" }, { label: "환불사유", lines: 5 }, { label: "담임선생님" },
  { label: "수강반", lines: 2 }, { label: "담당선생님" }, { label: "수업날짜" }, { label: "총수업횟수" }, { label: "환불요청일자" },
];
const REFUND_TOP: Row[] = [{ label: "결제내역", lines: 8, viewLines: 3 }, { label: "미환불금액", lines: 4 }, { label: "총 환불금액" }];

/**
 * 환불내역 표 — 실물처럼 4열: 묶음 머리(6줄에 걸침) · 항목 머리(w-28) · 값(앞 세 줄은 두 칸을 합침).
 * 뒤 세 줄은 '환불방식' 머리가 세 줄에 걸쳐 서고 그 옆에 방식 머리(w-28) · 값 칸. 방식 이름은 실물과 같은 `REFUND_METHODS`.
 */
function RefundTable({ editing }: { editing: boolean }) {
  return (
    <table className={`${T} mt-4`}>
      <tbody>
        {REFUND_TOP.map((row, i) => (
          <tr key={row.label}>
            {i === 0 ? (
              <th rowSpan={REFUND_TOP.length + REFUND_METHODS.length} className={`${CELL} w-20`}>
                <span className={TEXT_BAR}>환불내역</span>
              </th>
            ) : null}
            <th className={`${CELL} w-28 whitespace-nowrap`}>
              <span className={TEXT_BAR}>{row.label}</span>
            </th>
            <td colSpan={2} className={CELL}>
              <Value editing={editing} lines={row.lines} viewLines={row.viewLines} />
            </td>
          </tr>
        ))}
        {REFUND_METHODS.map((method, i) => (
          <tr key={method.key}>
            {i === 0 ? (
              <th rowSpan={REFUND_METHODS.length} className={`${CELL} whitespace-nowrap`}>
                <span className={TEXT_BAR}>환불방식</span>
              </th>
            ) : null}
            <th className={`${CELL} w-28 whitespace-nowrap`}>
              <span className={TEXT_BAR}>{method.label}</span>
            </th>
            <td className={CELL}>
              <Value editing={editing} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
const RESULT: Row[] = [
  { label: "환불처리일자" }, { label: "전산처리여부" }, { label: "담당자" }, { label: "환불완료일자" },
  { label: "완료 처리자", editNote: "환불완료일자를 입력·저장하면 자동 기록됩니다" },
];

/**
 * 환불 요청서 화면(`refunds/[id]` 보기 · `refunds/new` 작성) 스켈레톤 — 예전엔 둘 다 **수납관리 목록 스켈레톤**을 받아
 * 면 탭·요약 띠가 떴다가 종이 서식으로 바뀌었다. 실물 = `p-6` 안에 머리(뒤로가기·제목·설명) + 동작 줄 + 종이.
 * 두 화면은 머리 설명 글자(보기 text-xs · 작성 mt-1 text-sm)와 작성의 '학생 자동입력' 상자 · 입력칸 높이가 달라 `editing`으로 가른다.
 * 뒤로가기는 실물 `BackLink` 그대로 — 창(iframe) 안에선 스스로 숨으므로 창에서도 높이가 같다.
 */
export function RefundPageSkeleton({ editing }: { editing: boolean }) {
  return (
    <div className="print-portrait space-y-4 p-6">
      <header className="print:hidden">
        <BackLink href="/billing?tab=refunds" label="환불 요청서 목록으로" />
        <h1 className="mt-1 text-lg font-bold">
          <span aria-hidden className={TEXT_BAR}>{editing ? "환불 요청서 작성" : "환불 요청서 — 학생 이름"}</span>
        </h1>
        {editing ? (
          <p aria-hidden className="mt-1 text-sm">
            <span className={TEXT_BAR}>
              종이 서식의 각 칸에 바로 입력하세요 — 저장하면 데이터베이스(수납·결제)에 보관되고 언제든 다시 수정·A4 인쇄할 수 있습니다.
            </span>
          </p>
        ) : (
          <p aria-hidden className="text-xs">
            <span className={TEXT_BAR}>2026. 1. 1. 작성 · 작성자 · 데이터베이스(수납·결제)에 저장됨</span>
          </p>
        )}
      </header>
      <div role="status" aria-busy="true" aria-label="환불 요청서 불러오는 중" className="space-y-4">
        {/* 동작 줄 — 안내 한 줄 + 버튼(보기 = 수정·인쇄·삭제 · 작성 = 취소·저장, 기본 크기) */}
        <div aria-hidden className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <p className="text-xs">
            <span className={TEXT_BAR}>
              {editing ? "칸을 클릭해 바로 입력하세요 — *는 필수, 저장해야 반영됩니다." : "종이 서식 그대로 — 인쇄하거나 수정할 수 있습니다."}
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {(editing ? [0, 1] : [0, 1, 2]).map((i) => (
              <ToolbarSkeletonItem key={i} className="w-20" />
            ))}
          </div>
        </div>
        {editing ? (
          // 학생 자동입력 상자(`refund-student-picker.tsx`) — 검색 칸 한 줄 + 결제내역 기간 묶음 + 안내 한 줄.
          <div aria-hidden className="border-line bg-bg-soft/50 rounded-2xl border p-3 print:hidden">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`${TEXT_BAR} text-xs font-semibold whitespace-nowrap`}>학생 자동입력</span>
              <div className="min-w-[220px] flex-1">
                <div className="border-line rounded-md border px-3 py-2 text-sm">
                  <span className={TEXT_BAR}>학생 이름으로 검색...</span>
                </div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className={`${TEXT_BAR} text-xs whitespace-nowrap`}>결제내역 기간</span>
              <span className="border-line inline-flex rounded-lg border px-2.5 py-1 text-xs">
                <span className={TEXT_BAR}>이번 달 · 2개월 · 3개월 · 6개월 · 12개월 · 전체</span>
              </span>
            </div>
            <p className="mt-2 text-xs">
              <span className={TEXT_BAR}>
                이름을 고르면 학교/학년·주소·수강반·담당선생님·수강기간·결제내역이 채워집니다(빈 칸만). 결제내역은 위 기간만큼 — 다음 달 선청구는 항상 포함.
              </span>
            </p>
          </div>
        ) : null}
        {/* 종이 — 실물과 같은 표면·폭(780px)·여백. 표 넷(머리·학생 정보·환불내역·처리결과)의 줄 수도 같다. */}
        <div aria-hidden className="paper-scale border-line bg-card mx-auto w-full max-w-[780px] rounded-2xl border p-6 shadow-card sm:p-8">
          <table className={T}>
            <tbody>
              <tr>
                <td rowSpan={2} className={`${CELL} w-[46%] border-2 text-center`}>
                  <span className={`${TEXT_BAR} text-2xl leading-relaxed font-bold tracking-[0.3em]`}>환불처리요청서</span>
                </td>
                <th rowSpan={2} className={`${CELL} w-14`}>
                  <span className={TEXT_BAR}>결재</span>
                </th>
                {APPROVAL_SLOTS.map((slot) => (
                  <th key={slot.key} className={CELL}>
                    <span className={TEXT_BAR}>{slot.label}</span>
                  </th>
                ))}
              </tr>
              <tr>
                {APPROVAL_SLOTS.map((slot) => (
                  <td key={slot.key} className={`${CELL} h-16 align-bottom`} />
                ))}
              </tr>
            </tbody>
          </table>
          <GroupTable group="학생 정보" rows={STUDENT} editing={editing} />
          <RefundTable editing={editing} />
          <GroupTable group="처리결과" rows={RESULT} editing={editing} />
        </div>
      </div>
    </div>
  );
}
