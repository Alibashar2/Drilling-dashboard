import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, usePrefs } from './lib/context';
import { Notice, Spinner } from './components/ui';
import Layout from './components/Layout';
import Login from './pages/Login';

const Home = lazy(() => import('./pages/Home'));
const AddWell = lazy(() => import('./pages/AddWell'));
const Simulation = lazy(() => import('./pages/Simulation'));
const Wells = lazy(() => import('./pages/Wells'));
const WellDetail = lazy(() => import('./pages/WellDetail'));
const Problems = lazy(() => import('./pages/Problems'));
const Compare = lazy(() => import('./pages/Compare'));
const Estimate = lazy(() => import('./pages/Estimate'));
const Reports = lazy(() => import('./pages/Reports'));
const SettingsPage = lazy(() => import('./pages/Settings'));

export default function App() {
  const { status, error, user } = useAuth();
  const { t } = usePrefs();
  if (status === 'loading') return <div className="flex h-full items-center justify-center"><Spinner label={t('Opening database…')} /></div>;
  if (status === 'error') return <div className="mx-auto max-w-xl p-8"><Notice kind="error"><b>{t('The database could not be opened.')}</b><br />{error}</Notice></div>;
  if (!user) return <Login />;
  return (
    <Layout>
      <Suspense fallback={<Spinner label={t('Loading…')} />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/add-well" element={<AddWell />} />
          <Route path="/simulation" element={<Simulation />} />
          <Route path="/wells" element={<Wells />} />
          <Route path="/wells/:id" element={<WellDetail />} />
          <Route path="/problems" element={<Problems />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/estimate" element={<Estimate />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
