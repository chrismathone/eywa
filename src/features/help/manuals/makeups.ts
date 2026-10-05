import type { HelpManual } from "../types";

export const makeups: HelpManual = {
  slug: "makeups", title: "보강관리", href: "/makeups", menuKey: "makeups",
  group: "수업", layout: "list",
  summary: "결석 접수부터 보강 예약·수업 기록·실시 검토까지 보강 업무를 관리합니다. 학원 설정에서 켠 수학 운영에만 표시됩니다.",
  related: ["attendance", "onescreen", "owner", "billing"],
  callouts: [
    { n: 1, key: "makeups-filter", label: "상태·다음 업무·검색", zone: "toolbar",
      body: "담당 범위의 보강을 진행 중·보류·종결 상태와 다음 업무로 좁힙니다. 조회에 실패하면 오류를 표시하며 빈 목록으로 처리하지 않습니다." },
    { n: 2, key: "makeups-intake", label: "보강 접수·미연결 근거", zone: "header",
      body: "학생과 반·결석일(휴강은 휴강일)·메모를 확인해 ‘보강 접수’로 등록합니다. 미연결 결석이나 기존 보강 예약을 연결해도 승인 전 보강 시간은 미정입니다." },
    { n: 3, label: "승인·예약", zone: "row",
      body: "상세의 ‘보강 시간 승인’에서 시간을 분 단위로 승인하고 강사·강의실·날짜·교시를 정합니다. 예약한 시간은 다른 예약에 중복으로 배정할 수 없습니다. 실제 인정 전까지 남은 보강 시간은 줄지 않습니다." },
    { n: 4, label: "실시 기록·검토", zone: "row",
      body: "실제 지도 분과 보고서 또는 지도 근거를 기록해 검토에 제출합니다. 실시한 사람과 다른 검토자가 인정합니다. 정규 출석이나 발송만으로 완료되지 않습니다." },
    { n: 5, label: "대사·복구", zone: "header",
      body: "출결·시수·인계 차이와 반영 실패를 확인합니다. 대사를 실행하거나 근거를 정정해 재확인합니다. 시수와 청구액은 대사만으로 자동 변경하지 않습니다." },
    { n: 6, label: "도입 사전 점검", zone: "header",
      body: "기존 약속을 쓰기 없이 근거 등급·중복 후보로 분류합니다. 원본 해시를 확인한 뒤 따로 연결합니다. 원본이 바뀌면 다시 조회하며 자동 인정하지 않습니다." },
  ],
};
