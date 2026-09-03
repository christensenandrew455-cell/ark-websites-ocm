import "./globals.css";
import "./modal-overlays.css";
import "./mobile-viewport.css";
import SignupFlowShell from "./components/SignupFlowShell";
import ViewportMetrics from "./components/ViewportMetrics";
import { AuthProvider } from "./components/AuthProvider";
import GlobalConfirmDialog from "./components/GlobalConfirmDialog";

export const metadata = {
  title: "ARK Client Center",
  description: "Calls, leads, and clients for ARK businesses.",
  applicationName: "ARK Client Center",
  appleWebApp: {
    capable: true,
    title: "ARK Client Center",
    statusBarStyle: "black-translucent",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#020617",
  colorScheme: "light dark",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ViewportMetrics />
        <AuthProvider>
          <GlobalConfirmDialog />
          <SignupFlowShell>{children}</SignupFlowShell>
        </AuthProvider>
      </body>
    </html>
  );
}
