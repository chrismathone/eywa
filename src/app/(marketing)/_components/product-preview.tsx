"use client";

import { useState } from "react";
import { EyIcon, type AywaIconName } from "@/components/icons/aywa-icons";
import styles from "@/components/public-site/public-site.module.css";

const PREVIEWS: {
  label: string; icon: AywaIconName; title: string; description: string;
  metrics: [string, string][]; heading: string; rows: [AywaIconName, string, string][]; note: string;
}[] = [
  {
    label: "운영실", icon: "layoutGrid", title: "오늘의 학원을 한눈에", description: "수업과 학생, 확인할 업무를 모아봅니다.",
    metrics: [["수업", "오늘의 일정"], ["출결", "등원 현황"], ["운영", "확인할 업무"]], heading: "오늘 확인할 일",
    rows: [["calendar", "수업 일정 확인", "시간표"], ["userCheck", "학생 출결 살펴보기", "출석부"], ["wallet", "청구·납부 내역 확인", "수납관리"]],
    note: "필요한 업무 화면을 나란히 열어보세요.",
  },
  {
    label: "강사 시트", icon: "book", title: "수업의 앞뒤를 한곳에서", description: "담당 수업의 준비와 기록을 이어갑니다.",
    metrics: [["계획", "수업 준비"], ["진도", "학습 기록"], ["과제", "제출 확인"]], heading: "수업을 따라 이어지는 기록",
    rows: [["book", "반별 수업 계획과 진도", "강사 시트"], ["clipboardCheck", "학생별 과제 확인", "과제 관리"], ["report", "수업 내용 정리", "수업 보고"]],
    note: "영어·수학 수업에 맞는 강사 시트를 사용하세요.",
  },
  {
    label: "학생 관리", icon: "users", title: "학생의 변화를 놓치지 않게", description: "상담부터 학습까지 기록을 함께 살펴봅니다.",
    metrics: [["상담", "첫 만남부터"], ["등록", "학원 적응"], ["재원", "꾸준한 관리"]], heading: "학생을 살피는 흐름",
    rows: [["messages", "첫 상담과 등록 진행", "콜&상담"], ["userPlus", "새로운 학생의 적응", "신규생 관리"], ["exam", "학습 결과와 상담 기록", "성적·상담"]],
    note: "한 학생의 기록을 다음 상담과 관리로 이어가세요.",
  },
];

/** Illustrative product overview, separate from authenticated data. */
export function ProductPreview() {
  const [active, setActive] = useState(0);
  const preview = PREVIEWS[active];
  return (
    <div className={styles.previewStage}>
      <div className={styles.preview}>
        <div className={styles.previewTop}><span><EyIcon name="building" size={17} />AYWA</span><span>화면 구성 예시</span></div>
        <div className={styles.previewBody}>
          <div className={styles.previewNav} aria-label="기능 미리보기">
            {PREVIEWS.map((item, index) => (
              <button key={item.label} type="button" aria-pressed={active === index} aria-controls="product-preview-content" onClick={() => setActive(index)}>
                <EyIcon name={item.icon} size={18} /><span>{item.label}</span>
              </button>
            ))}
          </div>
          <div id="product-preview-content" className={styles.previewContent} aria-live="polite" aria-atomic="true">
            <h2>{preview.title}</h2><p className={styles.previewDescription}>{preview.description}</p>
            <div className={styles.previewMetrics}>
              {preview.metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
            </div>
            <h3>{preview.heading}</h3>
            <ul className={styles.previewRows}>
              {preview.rows.map(([icon, title, label]) => <li key={title}><EyIcon name={icon} size={18} /><span>{title}</span><small>{label}</small></li>)}
            </ul>
            <p className={styles.previewNote}><EyIcon name="layers" size={16} />{preview.note}</p>
          </div>
        </div>
      </div>
      <p className={styles.previewCaption}>우리 학원의 일, 한곳에서 이어집니다.</p>
    </div>
  );
}
