import type { ReactNode } from 'react';
import { OperatorSecurityShell } from './operator-security-shell';

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <OperatorSecurityShell>{children}</OperatorSecurityShell>
      </body>
    </html>
  );
}
