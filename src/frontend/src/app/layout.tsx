import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider as AuthContextProvider } from "@/context/AuthContext";
import { AuthProvider as UserProfileProvider } from "@/lib/auth";
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
        <AuthContextProvider>
          <UserProfileProvider>
            <LayoutShell>
              {children}
            </LayoutShell>
          </UserProfileProvider>
        </AuthContextProvider>
      </body>
    </html>
  );
}
