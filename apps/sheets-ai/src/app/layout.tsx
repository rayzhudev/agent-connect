import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sheets AI',
  description: 'AI-powered spreadsheet editor',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
