import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { RadioTower } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { startModalWatchdog } from "@/lib/modalWatchdog";
import { useAuth } from "@/context/AuthContext";
import { AlertsPage } from "@/pages/Alerts";
import { DeviceDetailPage } from "@/pages/DeviceDetail";
import { LoginPage } from "@/pages/Login";
import { OverviewPage } from "@/pages/Overview";
import { SettingsPage } from "@/pages/Settings";
import { SetupPage } from "@/pages/Setup";
import { UsersPage } from "@/pages/Users";

function Splash() {
  return (
    <div className="flex h-full items-center justify-center">
      <span className="flex h-11 w-11 animate-pulse items-center justify-center rounded-xl bg-white/[0.06] ring-1 ring-inset ring-white/10">
        <RadioTower className="h-5 w-5 text-foreground" />
      </span>
    </div>
  );
}

export default function App() {
  const { session, loading, needsSetup } = useAuth();
  const location = useLocation();

  useEffect(() => startModalWatchdog(), []);

  if (loading) return <Splash />;

  if (needsSetup) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} />
      </Routes>
    );
  }

  const isAdmin = session.user.role === "admin";

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/setup" element={<Navigate to="/" replace />} />
      <Route element={<DashboardLayout />}>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/devices/:id" element={<DeviceDetailPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/users" element={isAdmin ? <UsersPage /> : <Navigate to="/" replace />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
