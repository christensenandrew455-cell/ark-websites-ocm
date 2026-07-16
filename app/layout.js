import "./globals.css";
import AppShell from "./components/AppShell";
import { AuthProvider } from "./components/AuthProvider";

export const metadata = {
  title: "Tabor Painting Client Center",
  description: "AI receptionist activity and client collection for Tabor Painting",
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
