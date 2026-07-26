import Logo from "@/components/Logo";
import AccessGateForm from "@/components/AccessGateForm";

export default function AccessGatePage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const { next } = searchParams;
  const safeNext = next && next.startsWith("/") ? next : "/login";

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="flex justify-center mb-8">
          <Logo size="lg" />
        </div>

        <div className="bg-surface border border-border rounded-2xl p-8">
          <h1 className="font-syne text-2xl font-bold text-foreground mb-1">Private beta</h1>
          <p className="text-sm text-foreground-muted mb-6">
            Klyp is currently invite-only. Enter the access keyword to continue.
          </p>

          <AccessGateForm next={safeNext} />
        </div>
      </div>
    </div>
  );
}
