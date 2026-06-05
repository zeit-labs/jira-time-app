import type { Metadata } from 'next';
import { token } from '@atlaskit/tokens';
import '@atlaskit/css-reset';
import Providers from './providers';
import { AuthProvider } from '@/hooks/useAuth';
import ErrorBoundary from '@/components/ErrorBoundary';
import './globals.css';

export const metadata: Metadata = {
  title: 'Jira Time Logger',
  description: 'Weekly timesheet grid for Jira work log tracking',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className="antialiased"
        style={{
          backgroundColor: token('elevation.surface.sunken'),
          color: token('color.text'),
        }}
      >
        <Providers>
          <AuthProvider>
            <ErrorBoundary>
              <main className="min-h-screen">
                {children}
              </main>
            </ErrorBoundary>
          </AuthProvider>
        </Providers>
      </body>
    </html>
  );
}
