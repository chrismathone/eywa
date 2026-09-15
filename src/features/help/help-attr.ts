/** F1 겹침이 잡는 표식. 값은 manuals callouts[].key 와 같다. */
export function helpAttr(key: string): { "data-help": string } {
  return { "data-help": key };
}
