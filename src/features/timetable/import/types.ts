// 엑셀 import 라운드트립 타입. 자유텍스트 그리드 파싱(취약) 대신 enrollmentId로 앵커된
// 구조화 '수강편집' 시트를 쓴다 → diff/match가 견고하고 순수함수로 단위테스트 가능.

/** 현재 DB의 수강 1건(스냅샷). export 시 '수강편집' 시트로 직렬화. */
export interface EnrollmentSnapshotRow {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  school: string | null;
  grade: string | null;
  classId: string;
  className: string;
  /** 반의 과목 키(수학=math·영어=english…). 삭제(종료)를 **시트에 등장한 과목으로만** 한정하는 데 쓴다
   *  — 과목별 '수강편집' 시트가 다른 과목 수강을 실수로 종료하지 못하게(cross-subject remove 방지). */
  subject: string;
  /** 수강 시작일(YYYY-MM-DD). 시트 stale-drift 보호용 — 시트 생성 시점 이후 시작한 수강은 삭제 후보에서 제외. */
  startDate?: string | null;
}

/** 운영자가 편집해 다시 올린 '수강편집' 시트의 한 행. enrollmentId 없으면 신규 추가. */
export interface ParsedEditRow {
  enrollmentId: string | null;
  studentName: string;
  school: string | null;
  grade: string | null;
  className: string; // 운영자가 바꾼 대상 반
}

export interface ClassRef {
  classId: string;
  className: string;
  subject: string;
}

export interface StudentRef {
  studentId: string;
  name: string;
  school: string | null;
  grade: string | null;
}

export interface MoveChange {
  enrollmentId: string;
  studentName: string;
  fromClassName: string;
  toClassName: string;
  toClassId: string;
}
export interface RemoveChange {
  enrollmentId: string;
  studentName: string;
  className: string;
}
export interface AddChange {
  studentName: string;
  school: string | null;
  grade: string | null;
  className: string;
  classId: string;
  studentId: string;
}

export interface ImportDiff {
  moves: MoveChange[];
  removes: RemoveChange[];
  adds: AddChange[];
  unchanged: number;
  warnings: string[];
}
