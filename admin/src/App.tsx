import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "./app/i18n";
import { SessionProvider, useSession } from "./app/session";
import Layout from "./ui/components/Layout";
import ActivitiesPage from "./ui/pages/Activities";
import ChatPage from "./ui/pages/Chat";
import CompaniesPage from "./ui/pages/Companies";
import CompanyDetailPage from "./ui/pages/CompanyDetail";
import ContactsPage from "./ui/pages/Contacts";
import ContactDetailPage from "./ui/pages/ContactDetail";
import DashboardPage from "./ui/pages/Dashboard";
import DealDetailPage from "./ui/pages/DealDetail";
import DealsPage from "./ui/pages/Deals";
import HomePage from "./ui/pages/Home";
import LoginPage from "./ui/pages/Login";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function RequireSession({ children }: { children: React.ReactNode }) {
  const { session, status } = useSession();
  if (status === "loading") return null; // sin flash de redirect mientras se consulta /api/auth/me
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <SessionProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/"
                element={
                  <RequireSession>
                    <Layout />
                  </RequireSession>
                }
              >
                <Route index element={<HomePage />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="contacts" element={<ContactsPage />} />
                <Route path="contacts/:id" element={<ContactDetailPage />} />
                <Route path="companies" element={<CompaniesPage />} />
                <Route path="companies/:id" element={<CompanyDetailPage />} />
                <Route path="deals" element={<DealsPage />} />
                <Route path="deals/:id" element={<DealDetailPage />} />
                <Route path="activities" element={<ActivitiesPage />} />
                <Route path="chat" element={<ChatPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </SessionProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
