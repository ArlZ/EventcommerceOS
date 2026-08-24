import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from './app-shell';
import './globals.css';
import './operations.css';
import './workflow-polish.css';
import './interaction-polish.css';

export const metadata: Metadata = {
  title: 'Event Commerce OS — Event Control',
  description: 'Live event commerce operations, inventory, devices, setup and reconciliation.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
