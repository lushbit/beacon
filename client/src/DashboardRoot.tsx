import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { LiveProvider } from "./context/LiveContext";
import { VersionProvider } from "./context/VersionContext";
import { ToastProvider } from "./context/ToastContext";

/** The signed-in dashboard, with everything it needs around it. */
export default function DashboardRoot() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <LiveProvider>
            <VersionProvider>
              <App />
            </VersionProvider>
          </LiveProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
