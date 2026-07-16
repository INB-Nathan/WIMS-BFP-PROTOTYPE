import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "../styles/public-header.css";
import { AuthProvider as AuthContextProvider } from "@/context/AuthContext";
import { LayoutShell } from "@/components/LayoutShell";
import { GeolocationProvider } from "@/components/GeolocationProvider";
import { Toaster } from "sonner";

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
  // Gray PWA title bar — matches manifest.webmanifest theme_color.
  themeColor: '#4b5563',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthContextProvider>
          <LayoutShell>
            <GeolocationProvider>{children}</GeolocationProvider>
          </LayoutShell>
          <Toaster position="top-right" richColors />
        </AuthContextProvider>
      </body>
    </html>
  );
}
