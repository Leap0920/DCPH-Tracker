import { Navbar } from "@/components/layout/Navbar"

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-page">
      <Navbar />
      <main className="min-h-[calc(100vh-4rem)] pb-8">
        {children}
      </main>
    </div>
  )
}
