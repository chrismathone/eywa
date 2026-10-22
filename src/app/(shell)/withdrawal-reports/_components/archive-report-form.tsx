import type { ReactNode } from "react";
import type { ArchiveDetail } from "@/features/withdrawal-reports/archive-model";

const cell = "border border-black px-3 py-2 align-middle whitespace-pre-wrap break-words";
const heading = `${cell} text-center font-normal [font-family:Batang,바탕,serif]`;
const knownFields = new Set([
  "성명", "학년", "반명", "퇴원일", "수강기간", "담임명", "출결·현황", "출결현황",
  "퇴원사유", "상세사유", "상담결과", "학생상담", "학부모상담", "담임의견", "원비",
  "미납여부", "퇴원처리", "교무처진행담당자",
]);

/** 원본 시트의 결재란·병합 표 배치. 값과 빈 서명은 가져온 원문 그대로 둔다. */
export function ArchiveReportForm({ archive: a }: { archive: ArchiveDetail }) {
  const field = (key: string, fallback = "") => a.fields[key] ?? fallback;
  const subjectRow = a.raw_grid.findIndex(row => row.some(value => value.replace(/\s/g, "") === "과목"));
  const subjectColumn = a.raw_grid[subjectRow]?.findIndex(value => value.replace(/\s/g, "") === "과목");
  const subject = subjectColumn !== undefined && subjectColumn >= 0
    ? a.raw_grid[subjectRow + 1]?.[subjectColumn] ?? ""
    : a.subject === "math" ? "수학" : a.subject === "english" ? "영어" : a.subject ?? "";
  const extraFields = Object.entries(a.fields).filter(([key, value]) => !knownFields.has(key) && value);
  const fullRow = (label: ReactNode, value: string, tall = false) => (
    <tr>
      <th scope="row" colSpan={2} className={heading}>{label}</th>
      <td colSpan={10} className={cell}><div className={tall ? "min-h-28 py-2" : "min-h-6"}>{value}</div></td>
    </tr>
  );

  return (
    <section aria-label="기존 양식 퇴원 처리서" className="min-w-0">
      <p className="mb-2 text-xs text-muted-foreground sm:hidden">양식을 좌우로 움직여 전체 내용을 확인하세요.</p>
      <div className="overflow-x-auto rounded-lg border bg-muted/20 p-3 sm:p-6" role="region" aria-label="퇴원 처리서 양식" tabIndex={0}>
        <article className="mx-auto min-w-[820px] max-w-[920px] bg-white px-6 py-8 text-black sm:px-10 sm:py-10">
          <h2 className="mb-7 text-center text-[44px] font-bold leading-tight [font-family:Batang,바탕,serif]">퇴원 처리서</h2>
          <table aria-label="원본 결재란" className="mb-7 ml-auto w-2/3 table-fixed border-collapse text-sm">
            <colgroup><col className="w-[10%]" /><col className="w-[15%]" /><col /><col /><col /></colgroup>
            <tbody>
              <tr>
                <th rowSpan={3} scope="rowgroup" className={heading}>결재</th>
                <th scope="col" className={heading}>과목</th>
                {["담임", "팀장", "원장"].map(role => <th key={role} scope="col" className={heading}>{role}</th>)}
              </tr>
              <tr>
                <td rowSpan={2} className={`${cell} text-center`}>{subject}</td>
                {["담임", "팀장", "원장"].map(role => <td key={role} className={`${cell} text-xs`}>{a.signatures.find(s => s.role === role)?.date ?? ""}</td>)}
              </tr>
              <tr>
                {["담임", "팀장", "원장"].map(role => <td key={role} className={`${cell} h-14 text-center`}>{a.signatures.find(s => s.role === role)?.name ?? ""}</td>)}
              </tr>
            </tbody>
          </table>
          <table aria-label="퇴원 보고 내용" className="w-full table-fixed border-collapse text-sm leading-relaxed">
            <colgroup>{[9, 14, 9, 14, 9, ...Array<number>(7).fill(45 / 7)].map((width, i) => <col key={i} style={{ width: `${width}%` }} />)}</colgroup>
            <tbody>
              <tr>
                <th scope="row" className={heading}>성명</th><td className={cell}>{field("성명", a.student_name)}</td>
                <th scope="row" className={heading}>학년</th><td className={cell}>{field("학년", a.school_grade)}</td>
                <th scope="row" className={heading}>반명</th><td colSpan={7} className={cell}>{field("반명", a.class_name)}</td>
              </tr>
              <tr>
                <th scope="row" className={heading}>퇴원일</th><td colSpan={3} className={cell}>{field("퇴원일", a.raw_exit_date)}</td>
                <th scope="row" colSpan={2} className={heading}>수강기간</th><td colSpan={6} className={cell}>{field("수강기간")}</td>
              </tr>
              <tr>
                <th scope="row" className={heading}>담임명</th><td colSpan={3} className={cell}>{field("담임명", a.teacher_name)}</td>
                <th scope="row" colSpan={2} className={heading}>출결·현황</th><td colSpan={6} className={cell}>{field("출결·현황", field("출결현황"))}</td>
              </tr>
              {fullRow("퇴원사유", field("퇴원사유"))}
              {fullRow(<>퇴원 상세 사유<span className="mt-1 block text-xs">(10pt, 200자 이상)</span></>, field("상세사유"), true)}
              <tr>
                <th scope="rowgroup" rowSpan={2} colSpan={2} className={heading}>상담결과{field("상담결과") && <div className="mt-2 text-left text-xs">{field("상담결과")}</div>}</th>
                <th scope="row" colSpan={2} className={heading}>학생 상담</th><td colSpan={8} className={cell}><div className="min-h-20 py-2">{field("학생상담")}</div></td>
              </tr>
              <tr>
                <th scope="row" colSpan={2} className={heading}>학부모상담</th><td colSpan={8} className={cell}><div className="min-h-20 py-2">{field("학부모상담")}</div></td>
              </tr>
              {fullRow("담임의견", field("담임의견"), true)}
              {fullRow("원비", field("원비"))}
              {fullRow("미납여부", field("미납여부"))}
              <tr>
                <th scope="row" className={heading}>퇴원<br />처리</th>
                <th scope="row" className={`${heading} px-1 text-xs`}>교무처<br />진행담당자</th>
                <td colSpan={10} className={cell}>{[field("퇴원처리"), field("교무처진행담당자")].filter(Boolean).join("\n")}</td>
              </tr>
              {extraFields.map(([key, value]) => <tr key={key}><th scope="row" colSpan={2} className={heading}>{key}</th><td colSpan={10} className={cell}>{value}</td></tr>)}
            </tbody>
          </table>
        </article>
      </div>
    </section>
  );
}
