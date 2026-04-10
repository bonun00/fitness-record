import type {Metadata} from 'next';
import './globals.css'; // Global styles
import { AuthProvider } from '@/lib/auth-context';
import ErrorBoundary from '@/components/error-boundary';

export const metadata: Metadata = {
  title: 'FitTrack AI',
  description: 'AI-powered workout tracker',
  icons: {
    icon: [],
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <ErrorBoundary>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
