// 데이터베이스 목록 표의 열 표식 — 행(클라 컴포넌트)과 표(서버 컴포넌트)가 함께 쓰는 **일반 모듈**이다
// (#81: "use client" 파일의 문자열 상수를 서버가 가져오면 런타임에 undefined가 된다).
//
// 좁은 표에서 숨길 수 있는 열에만 붙인다. 숨기는 규칙(폭 기준·정렬 중인 열 예외)은 document-table.tsx가
// **표 한 곳**에서 건다 — 행마다 규칙을 적으면 한 군데를 빠뜨리는 순간 머리와 칸이 어긋난다.
export const DOC_COL = {
  type: "doc-col-type",
  created: "doc-col-created",
  uploader: "doc-col-uploader",
} as const;
