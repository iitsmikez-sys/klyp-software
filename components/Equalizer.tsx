const BAR_COUNT = 24;

/** CSS-animated audio-visualizer bars. Deterministic per-bar timing so it
 *  renders identically on server and client. */
export default function Equalizer({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-end gap-[3px] h-10 ${className}`} aria-hidden>
      {Array.from({ length: BAR_COUNT }, (_, i) => {
        const dur = 0.7 + ((i * 7) % 10) * 0.09;
        const delay = ((i * 13) % 10) * -0.12;
        const peak = 0.35 + ((i * 11) % 10) * 0.065;
        return (
          <span
            key={i}
            className="eq-bar w-[4px] rounded-full bg-accent/70"
            style={{
              height: "100%",
              animationDuration: `${dur}s`,
              animationDelay: `${delay}s`,
              transform: `scaleY(${peak * 0.5})`,
              ["--eq-peak" as string]: peak,
            }}
          />
        );
      })}
    </div>
  );
}
