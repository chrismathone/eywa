/** 확장자는 저장된 원본 파일명에서만 구한다. 이름 변경 요청으로 덮어쓰지 않는다. */
export function splitFileName(fileName: string): { base: string; extension: string } {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 && dot < fileName.length - 1
    ? { base: fileName.slice(0, dot), extension: fileName.slice(dot) }
    : { base: fileName, extension: "" };
}

export function renamedFileName(baseName: string, originalFileName: string): { fileName: string } | { error: string } {
  const base = baseName.trim();
  if (!base || base === "." || base === "..") return { error: "파일 이름을 입력해 주세요." };
  if (base.length > 180 || /[\\/:*?"<>|]/.test(base) || Array.from(base).some((c) => c.charCodeAt(0) < 32) || base.endsWith("."))
    return { error: "파일 이름은 180자 이내로, 경로 구분자나 특수문자 없이 입력해 주세요." };
  const extension = splitFileName(originalFileName).extension;
  if (!extension && splitFileName(base).extension) return { error: "확장자가 없는 파일에는 확장자를 추가할 수 없습니다." };
  return { fileName: base + extension };
}
