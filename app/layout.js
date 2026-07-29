import "./globals.css";
import "./modal-overlays.css";
import "./mobile-viewport.css";
import SignupFlowShell from "./components/SignupFlowShell";
import ViewportMetrics from "./components/ViewportMetrics";
import { AuthProvider } from "./components/AuthProvider";

export const metadata = {
  title: "ARK Client Center",
  description: "AI receptionist activity, lead notifications, and client management for ARK customers.",
  applicationName: "ARK Client Center",
  appleWebApp: {
    capable: true,
    title: "ARK Client Center",
    statusBarStyle: "default",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
  colorScheme: "light dark",
};

const themeScript = `
try {
  if (window.localStorage.getItem("ark-theme-v1") === "dark") {
    document.documentElement.classList.add("ark-dark");
  }
} catch {}
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>
        <ViewportMetrics />
        <AuthProvider>
          <SignupFlowShell>{children}</SignupFlowShell>
        </AuthProvider>
      </body>
    </html>
  );
}
