import React from 'react';

export interface TradeMultiSelectOption {
  value: string;
  label: string;
}

interface TradeMultiSelectProps {
  allLabel: string;
  emptyLabel: string;
  selected: 'ALL' | string[];
  options: TradeMultiSelectOption[];
  onChange: (selected: 'ALL' | string[]) => void;
  className?: string;
}

export const TradeMultiSelect: React.FC<TradeMultiSelectProps> = ({
  allLabel,
  emptyLabel,
  selected,
  options,
  onChange,
  className = '',
}) => {
  const selectedValues = selected === 'ALL' ? options.map((option) => option.value) : selected;
  const summary = selected === 'ALL'
    ? allLabel
    : selected.length === 0
      ? emptyLabel
      : options.filter((option) => selected.includes(option.value)).map((option) => option.label).join(', ');

  const toggleOption = (value: string) => {
    const next = selectedValues.includes(value)
      ? selectedValues.filter((current) => current !== value)
      : [...selectedValues, value];
    onChange(next.length === options.length ? 'ALL' : next);
  };

  return (
    <details className={`relative ${className}`}>
      <summary className="max-w-40 cursor-pointer list-none truncate rounded border border-slate-200 bg-white px-2 py-1 text-[9px] font-bold text-slate-700 [&::-webkit-details-marker]:hidden">
        {summary} <span className="text-slate-400">▾</span>
      </summary>
      <div className="absolute left-0 top-full z-50 mt-1 max-h-56 min-w-44 overflow-auto rounded border border-slate-200 bg-white p-1.5 shadow-xl">
        <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[9px] font-black text-indigo-700 hover:bg-indigo-50">
          <input type="checkbox" checked={selected === 'ALL'} onChange={() => onChange(selected === 'ALL' ? [] : 'ALL')} />
          {allLabel}
        </label>
        <div className="my-1 border-t border-slate-100" />
        {options.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[9px] font-bold text-slate-700 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={selected === 'ALL' || selected.includes(option.value)}
              onChange={() => toggleOption(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </details>
  );
};
