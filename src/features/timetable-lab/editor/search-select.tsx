import { useId, useState } from 'react';

/** 검색으로 선택값을 바꾸지 않는다. 검색 밖의 현재 선택도 남겨 실수로 다른 항목을 적용하지 않게 한다. */
export function SearchSelect({ label, value, options, onChange }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void;
}) {
  const id = useId(), [query, setQuery] = useState('');
  const clean = (text: string) => text.replace(/\s/g, '').toLocaleLowerCase();
  const matches = options.filter(option => clean(option.label).includes(clean(query)));
  const selected = options.find(option => option.value === value);
  const outside = selected && !matches.includes(selected);
  return <div className="search-picker">
    <label htmlFor={id}>{label}</label>
    <input type="search" aria-label={`${label} 검색`} placeholder={`${label} 검색`} value={query} onChange={event => setQuery(event.target.value)} />
    <select id={id} aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
      {outside && <optgroup label="현재 선택"><option value={selected.value}>{selected.label}</option></optgroup>}
      {matches.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    {query && !matches.length && <small role="status">검색 결과가 없습니다.</small>}
  </div>;
}
