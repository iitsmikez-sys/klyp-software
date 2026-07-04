export default function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizes = {
    sm: "text-lg",
    md: "text-xl",
    lg: "text-3xl",
  };

  return (
    <span className={`font-syne font-bold tracking-tight ${sizes[size]}`}>
      <span className="text-foreground">kl</span>
      <span className="text-accent">yp</span>
    </span>
  );
}
