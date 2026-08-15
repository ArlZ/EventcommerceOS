import type { ReactNode } from 'react';
import { OperatorSessionControl } from './operator-session-control';

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <OperatorSessionControl />
        {children}
      </body>
    </html>
  );
}
