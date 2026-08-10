import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SeismicLens — Seismic Testnet Health Monitor',
  description: 'Real-time network health dashboard for the Seismic privacy-enabled blockchain testnet.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
