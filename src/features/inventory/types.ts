/**
 * 재고관리 타입 — 0242a 표의 앱쪽 표현. 순수 모듈(IO·server-only 없음)이라 서버 컴포넌트와
 * 클라이언트 컴포넌트가 함께 import한다([[#81]]).
 *
 * 날짜는 전부 `YYYY-MM-DD` 문자열(date 컬럼). 모르는 값은 null(unknown-value.ts 규약).
 */

export type InventoryAsset = {
  id: string;
  /** 사람이 읽는 자산ID(라벨 번호) — `NB-002`. */
  assetCode: string;
  category: string;
  maker: string | null;
  model: string | null;
  serialNo: string | null;
  acquiredOn: string | null;
  status: string;
  location: string | null;
  holderUserId: string | null;
  /** 대여중일 때 빌려 간 사람(계정이 없을 수도 있어 이름 스냅샷). */
  holderName: string | null;
  lastAuditedOn: string | null;
  disposedOn: string | null;
  note: string | null;
  sortOrder: number;
};

export type InventoryLoan = {
  id: string;
  assetId: string;
  /** 자산 표에서 임베드(FK 이름 명시, [[#94]]) — 자산이 지워지면 대여 행도 cascade라 항상 있다. */
  assetCode: string;
  assetModel: string | null;
  loanCode: string;
  borrowerUserId: string | null;
  borrowerName: string;
  dept: string | null;
  lentOn: string | null;
  dueOn: string | null;
  /** `상시`처럼 날짜가 아닌 반납예정 표기. */
  dueNote: string | null;
  returnedOn: string | null;
  status: string;
  /** 대여 전 자산 상태 — 반납 때 이 값으로 되돌린다(없으면 사용중). */
  prevStatus: string | null;
  note: string | null;
};

export type InventoryAudit = {
  id: string;
  assetId: string;
  assetCode: string;
  assetModel: string | null;
  auditCode: string;
  auditedOn: string;
  result: string;
  location: string | null;
  auditorUserId: string | null;
  auditorName: string | null;
  action: string | null;
  note: string | null;
};

export type InventorySupply = {
  id: string;
  itemCode: string | null;
  name: string;
  makerModel: string | null;
  qty: number;
  location: string | null;
  checkedOn: string | null;
  checkerName: string | null;
  note: string | null;
  sortOrder: number;
};

/** 활성 면의 대여 다이얼로그 등이 고를 자산 요약 — 목록 전체를 폼에 실을 필요는 없다. */
export type AssetOption = Pick<InventoryAsset, "id" | "assetCode" | "category" | "model" | "status" | "location">;
