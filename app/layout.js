import "./globals.css";

export const metadata = {
  title: "ARK Websites OCM",
  description: "Online Client Management system for ARK Websites clients",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
