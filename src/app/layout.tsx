import type { Metadata } from 'next';
import { Expletus_Sans, Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { CustomerQueryProvider } from '@/features/customer-session/components/CustomerQueryProvider';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

/** Brand/display moments only — never the default application font. */
const expletus = Expletus_Sans({
  subsets: ['latin'],
  weight: ['700'],
  variable: '--font-expletus',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Steward', template: '%s · Steward' },
};

/**
 * The customer application (F-01): mobile-first, no restaurant-user session,
 * and a query client whose 401 handling never leads to a sign-in page.
 * Restaurant branding (F8-BCD-5) is not provided by the backend yet, so the
 * Steward base design applies as the safe default.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" className={`${inter.variable} ${expletus.variable}`}>
      <body className="bg-background font-sans text-text antialiased">
        <CustomerQueryProvider>
          <main className="mx-auto min-h-dvh w-full max-w-xl px-5 py-6">{children}</main>
        </CustomerQueryProvider>
      </body>
    </html>
  );
}
