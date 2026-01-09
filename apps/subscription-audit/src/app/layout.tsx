import '../styles/globals.css'

export const metadata = {
  title: 'Subscription Audit',
  description: 'Find and reduce recurring subscriptions with local AgentConnect analysis.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
