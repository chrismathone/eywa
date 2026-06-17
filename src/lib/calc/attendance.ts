/**
 * 출석률 % (0~100, 반올림 없이 원값). total<=0이면 0(0-나눗셈 방어).
 * 출석부·수업·상담·대시보드·학생 5곳에 흩어져 각자 구현되던 식을 하나로 통일(#Q3).
 * 표시 자릿수/문자열은 호출부에서 포맷(`.toFixed(1)` 등).
 */
export function attendanceRate(present: number, total: number): number {
  return total > 0 ? (present / total) * 100 : 0;
}
