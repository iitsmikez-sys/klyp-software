import { SparksProvider } from "@/components/SparksProvider";

export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return <SparksProvider>{children}</SparksProvider>;
}
