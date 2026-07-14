import "./globals.css";
import AppShell from "./components/AppShell";
import { AuthProvider } from "./components/AuthProvider";

export const metadata = {
  title: "ARK Websites OCM",
  description: "Secure online client management for ARK Websites clients",
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
