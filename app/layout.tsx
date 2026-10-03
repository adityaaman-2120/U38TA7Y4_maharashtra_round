import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Heirloom — Trust-Minimized Digital Inheritance',
  description:
    'Transfers protected digital assets to designated heirs on verified unavailability. No single party can unilaterally access the owner\u2019s secrets.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans text-slate-200 antialiased">{children}</body>
    </html>
  );
}
