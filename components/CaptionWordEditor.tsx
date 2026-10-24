"use client";

import type { TimedWord } from "@/lib/clips";

type Props = {
  words: TimedWord[];
  originalStart: number;
  disabled?: boolean;
  onChange: (words: TimedWord[]) => void;
};

export default function CaptionWordEditor({ words, originalStart, disabled, onChange }: Props) {
  return (
    <div>
      <p className="text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted mb-1">Correct caption words</p>
      <p className="text-[10px] text-subtle mb-2">Change the text; timing stays aligned to the spoken words.</p>
      <div className="max-h-44 overflow-y-auto scrollbar-thin rounded-lg border border-border bg-surface-2/50 p-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
        {words.map((word, index) => (
          <label key={`${word.start}-${index}`} className="text-[10px] text-subtle">
            {Math.max(0, (word.start / 1000 - originalStart)).toFixed(1)}s
            <input aria-label={`Caption word ${index + 1}`} type="text" maxLength={80} value={word.text}
              disabled={disabled}
              onChange={(event) => onChange(words.map((item, i) => i === index ? { ...item, text: event.target.value } : item))}
              className="mt-0.5 w-full rounded border border-border bg-surface-2 px-2 py-1 text-xs text-foreground disabled:opacity-50" />
          </label>
        ))}
      </div>
    </div>
  );
}
