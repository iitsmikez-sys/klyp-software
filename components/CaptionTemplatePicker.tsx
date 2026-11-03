"use client";

import { useState } from 'react';
import { CAPTION_STYLES, type CaptionStyle } from '@/lib/clips';

const featuredStyles: readonly CaptionStyle[] = ['BOLD', 'CLEAN', 'KLYP', 'PULSE', 'HYPE', 'POP', 'FIRE'];

const templateInfo: Record<CaptionStyle, { name: string; detail: string; sample: string }> = {
  BOLD: { name: 'Bold', detail: 'Clear and direct', sample: 'BIG MOMENT' },
  CLEAN: { name: 'Clean', detail: 'Quiet and minimal', sample: 'The story starts here' },
  KLYP: { name: 'Klyp', detail: 'One word at a time', sample: 'UNREAL' },
  PULSE: { name: 'Pulse', detail: 'Bright entrance', sample: 'NO WAY' },
  SLIDE: { name: 'Slide', detail: 'Smooth rise', sample: 'Watch this...' },
  SPARK: { name: 'Spark', detail: 'Quick word pop', sample: 'CLUTCH' },
  BOUNCE: { name: 'Bounce', detail: 'Playful impact', sample: 'LET’S GO' },
  GLOW: { name: 'Glow', detail: 'Soft luminous look', sample: 'THIS IS IT' },
  COMIC: { name: 'Comic Pop', detail: 'Yellow impact', sample: 'SPECIFIC ANIME' },
  KEYWORD: { name: 'Keyword Pop', detail: 'Green word focus', sample: 'BEEN SO FORTUNATE' },
  HYPE: { name: 'Hype', detail: 'Red word focus', sample: 'BROWN FOX' },
  POP: { name: 'Pop', detail: 'One huge word', sample: 'THE' },
  FIRE: { name: 'Fire', detail: 'Green word and emoji', sample: 'THE QUICK BROWN' },
};

export default function CaptionTemplatePicker({ value, onChange }: {
  value: CaptionStyle;
  onChange: (style: CaptionStyle) => void;
}) {
  const [expanded, setExpanded] = useState(() => !featuredStyles.includes(value));
  const visibleStyles = expanded ? CAPTION_STYLES : CAPTION_STYLES.filter(style => featuredStyles.includes(style) || style === value);
  return <section className="caption-template-section" aria-label="Caption templates">
    <div className="editor-section-heading"><div><h3>Caption look</h3><p>Choose how your words appear on video.</p></div></div>
    <div className="caption-template-grid">
      {visibleStyles.map(style => {
        const info = templateInfo[style];
        return <button key={style} type="button" className="caption-template-card" data-style={style.toLowerCase()} aria-label={`${info.name} caption template`} aria-pressed={value === style} onClick={() => onChange(style)}>
          <span className="caption-template-sample"><b>{style === 'KEYWORD' ? <>BEEN <em>SO</em> FORTUNATE</> : style === 'HYPE' ? <>BROWN <em>FOX</em></> : style === 'FIRE' ? <>THE QUICK <em>BROWN</em> 🔥</> : info.sample}</b></span>
          <span className="caption-template-meta"><strong>{info.name}</strong><small>{info.detail}</small></span>
        </button>;
      })}
    </div>
    <button type="button" className="caption-template-more" aria-expanded={expanded} onClick={() => setExpanded(open => !open)}>{expanded ? 'Show fewer styles' : `See all ${CAPTION_STYLES.length} styles`}</button>
  </section>;
}
