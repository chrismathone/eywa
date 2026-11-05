import type { ReactNode } from "react";
import styles from "./report-sheet.module.css";

type Signature = { role: string; date: ReactNode; name: ReactNode };
export type ReportSheetFields = Record<"name" | "grade" | "className" | "exitDate" | "period" | "teacher" | "attendance" | "reason" | "detail" | "studentConsultation" | "parentConsultation" | "teacherOpinion" | "tuition" | "arrears" | "processing", ReactNode>;

/** 신규 작성·조회와 기존 보고서에 동일한 원본 표 구조를 사용한다. */
export function ReportSheet({ fields: f, subject, signatures, archive = false, consultationNote, consultationLinks, refundCheck, extraFields = [] }: {
  fields: ReportSheetFields; subject: ReactNode; signatures: Signature[]; archive?: boolean;
  consultationNote?: ReactNode; consultationLinks?: ReactNode; extraFields?: [string, ReactNode][];
  /** 환불 확인 칸(원장 2026-10-30) — 퇴원월 뒤 수납 청구와 줄별 환불 토글. 웹 보고서에만. */
  refundCheck?: ReactNode;
}) {
  const fullRow = (label: ReactNode, value: ReactNode, tall = false) => <tr>
    <th scope="row" colSpan={2}>{label}</th>
    <td colSpan={10}><div className={tall ? styles.writing : undefined}>{value}</div></td>
  </tr>;
  return <section aria-label={archive ? "기존 양식 퇴원 보고서" : "퇴원 보고서"} className="min-w-0">
    <article className={`${styles.sheet} paper-scale`}>
      <h2>퇴원 보고서</h2>
      <table aria-label={archive ? "원본 결재란" : "결재란"} className={styles.approval}>
        <colgroup><col style={{ width: "12.5%" }} /><col style={{ width: "12.5%" }} /><col /><col /><col /></colgroup>
        <tbody>
          <tr><th rowSpan={3} scope="rowgroup">결재</th><th scope="col">과목</th>{signatures.map(s => <th scope="col" key={s.role}>{s.role}</th>)}</tr>
          <tr><td rowSpan={2}>{subject}</td>{signatures.map(s => <td key={s.role} className={styles.dates}>{s.date}</td>)}</tr>
          <tr>{signatures.map(s => <td key={s.role} className={styles.signature}>{s.name}</td>)}</tr>
        </tbody>
      </table>
      <table aria-label="퇴원 보고 내용" className={styles.body}>
        <colgroup>{Array.from({ length: 12 }, (_, i) => <col key={i} style={{ width: `${100 / 12}%` }} />)}</colgroup>
        <tbody>
          <tr><th scope="row">성명</th><td>{f.name}</td><th scope="row">학년</th><td>{f.grade}</td><th scope="row">반명</th><td colSpan={7}>{f.className}</td></tr>
          {/* 웹 보고서의 날짜 = 마지막 수업일(원장 2026-11-03 — 목록·요청 창과 같은 이름) · 기존 원본 양식은 원문 머리글 '퇴원일' 그대로. */}
          <tr><th scope="row">{archive ? "퇴원일" : "마지막 수업일"}</th><td colSpan={3}>{f.exitDate}</td><th scope="row" colSpan={2}>수강기간</th><td colSpan={6}>{f.period}</td></tr>
          <tr><th scope="row">담임명</th><td colSpan={3}>{f.teacher}</td><th scope="row" colSpan={2}>{archive ? "출결·현황" : "최근 3개월 출결 현황"}</th><td colSpan={6}>{f.attendance}</td></tr>
          {fullRow("퇴원사유", f.reason)}
          {fullRow("퇴원 상세 사유", f.detail, true)}
          <tr><th scope="rowgroup" rowSpan={2} colSpan={2}>상담결과{consultationNote && <div>{consultationNote}</div>}</th><th scope="row" colSpan={2}>학생 상담</th><td colSpan={8}><div className={styles.consultation}>{f.studentConsultation}</div></td></tr>
          <tr><th scope="row" colSpan={2}>학부모상담</th><td colSpan={8}><div className={styles.consultation}>{f.parentConsultation}</div></td></tr>
          {consultationLinks && fullRow("연결 상담", consultationLinks)}
          {fullRow("담임의견", f.teacherOpinion, true)}
          {fullRow("원비", f.tuition)}
          {fullRow("미납여부", f.arrears)}
          {refundCheck && fullRow("환불 확인", refundCheck)}
          <tr><th scope="row">퇴원<br />처리</th><th scope="row" className={styles.processingLabel}>교무처<br />진행담당자</th><td colSpan={10}>{f.processing}</td></tr>
          {extraFields.map(([label, value]) => <tr key={label}><th scope="row" colSpan={2}>{label}</th><td colSpan={10}>{value}</td></tr>)}
        </tbody>
      </table>
    </article>
  </section>;
}
