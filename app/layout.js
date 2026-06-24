import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "ARK Websites OCM",
  description: "Online Client Management system for ARK Websites clients",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="relative border-b border-slate-200 bg-white px-8 py-4 shadow-sm">
          <Link
            href="/"
            className="text-sm font-semibold text-slate-700 hover:text-slate-950"
          >
            Dashboard
          </Link>

          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-lg font-bold tracking-tight text-slate-950">
            ARK Website OCM
          </div>
        </header>

        {children}
      </body>
    </html>
  );
}
