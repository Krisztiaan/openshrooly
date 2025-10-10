import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'OpenShrooly Dashboard',
  description: 'Monitor your mushroom growing environment',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
