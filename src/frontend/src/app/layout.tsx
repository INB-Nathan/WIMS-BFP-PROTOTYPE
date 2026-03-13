import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { LayoutShell } from "@/components/LayoutShell";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "WIMS-BFP Prototype",
  description: "Wildfire Incident Management System - Bureau of Fire Protection",
  icons: {
    icon: "/bfp-logo.ico",
    shortcut: "/bfp-logo.ico",
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          {/* We might want some pages (like login) to NOT have the full shell, 
                but for now let's wrap everything in the shell or check path in shell.
                Actually, simpler to just put Shell here and let it handle auth state display.
            */}
          <LayoutShell>
            {children}
          </LayoutShell>
        </AuthProvider>
      </body>
    </html>
  );
}
