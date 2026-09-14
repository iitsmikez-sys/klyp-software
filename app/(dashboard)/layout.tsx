import Sidebar from "@/components/Sidebar";
import MobileNav from "@/components/MobileNav";
import { SparksProvider } from "@/components/SparksProvider";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SparksProvider>
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <MobileNav />
          {/* pb-16 clears the fixed mobile bottom tab bar (md:hidden, see MobileNav) */}
          <main className="flex-1 overflow-y-auto scrollbar-thin pb-16 md:pb-0">
            {children}
          </main>
        </div>
      </div>
    </SparksProvider>
  );
}
