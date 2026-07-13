import { Sidebar } from "@/components/layout/Sidebar"

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-noir-black">
      <Sidebar />
      <main className="md:ml-64 min-h-screen">
        {children}
      </main>
    </div>
  )
}
