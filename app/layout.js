import "./globals.css";
import AppShell from "./components/AppShell";
import { AuthProvider } from "./components/AuthProvider";

export const metadata = {
  title: "ARK Client Center",
  description: "AI receptionist activity, lead notifications, and client management for ARK customers.",
  applicationName: "ARK Client Center",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
