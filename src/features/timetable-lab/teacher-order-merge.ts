/** 이미 저장된 개인 순서를 바탕으로 실제로 옮긴 열만 이동한다. 화면 밖 강사와 나머지 상대 순서는 남긴다. */
export function mergeMovedTeacherOrder(current: readonly string[], initial: readonly string[], desired: readonly string[]) {
  const base = [...new Set(initial)].filter(name => desired.includes(name)), target = [...new Set(desired)];
  const length = Array.from({ length: base.length + 1 }, () => Array(target.length + 1).fill(0) as number[]);
  for (let i = base.length - 1; i >= 0; i--) for (let j = target.length - 1; j >= 0; j--) length[i][j] = base[i] === target[j] ? length[i + 1][j + 1] + 1 : Math.max(length[i + 1][j], length[i][j + 1]);
  const fixed = new Set<string>();
  for (let i = 0, j = 0; i < base.length && j < target.length;) {
    if (base[i] === target[j]) { fixed.add(base[i]); i++; j++; }
    else if (length[i + 1][j] >= length[i][j + 1]) i++; else j++;
  }
  const result = [...new Set([...current, ...base.filter(name => !current.includes(name))])];
  for (let i = target.length - 1; i >= 0; i--) {
    const name = target[i];
    if (fixed.has(name)) continue;
    const old = result.indexOf(name); if (old >= 0) result.splice(old, 1);
    const anchor = target.slice(i + 1).find(name => result.includes(name));
    result.splice(anchor ? result.indexOf(anchor) : result.length, 0, name);
  }
  return result;
}
