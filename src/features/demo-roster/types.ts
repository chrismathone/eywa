/** 대시보드 드롭다운이 받는 값. 화면 문구는 label뿐이고 id는 서버로만 간다. */
export type DemoRosterControl = {
  currentId: string | null;
  /** 표시만. 구성이 둘 이상 섞여 있으면 어느 쪽도 '사용 중'으로 찍지 않는다. */
  mixed: boolean;
  options: { id: string; label: string }[];
};
