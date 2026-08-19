import { Navbar } from "@/components/layout/Navbar"

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-page">
      <Navbar />
      {/* pt-16 clears the fixed h-16 navbar. Every (app) page relies on this;
          the only page that compensates itself is /characters, whose wrapper is
          fixed-position and therefore immune to this padding. */}
      <main className="min-h-[calc(100dvh-4rem)] pt-16 pb-8">
        {children}
      </main>
    </div>
  )
}