import { AppProviders } from '@/app/AppProviders'
import { AppShell } from '@/app/AppShell'
import { DocumentLibraryProvider } from '@/app/DocumentLibraryContext'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'

export function App() {
  return (
    <AppProviders>
      <DocumentLibraryProvider>
        <ErrorBoundary title="SmartPDF Studio crashed">
          <AppShell />
        </ErrorBoundary>
      </DocumentLibraryProvider>
    </AppProviders>
  )
}

export default App
