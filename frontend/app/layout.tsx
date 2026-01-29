import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import MobileBottomNav from "@/components/layout/MobileBottomNav";
import { AuthProvider } from "@/contexts/AuthContext";
import AuthGuard from "@/components/auth/AuthGuard";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "VAS - Video Aggregation Service",
  description: "Professional video streaming and aggregation platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-100`}>
        <AuthProvider>
          <AuthGuard>
            <div className="h-screen overflow-hidden flex flex-col">
              <Header />
              <div className="flex flex-1 overflow-hidden relative">
                <Sidebar />
                <main className="flex-1 md:ml-64 overflow-y-auto bg-gray-50 p-4 md:p-6 pb-20 md:pb-6">
                  {children}
                </main>
              </div>
              <MobileBottomNav />
            </div>
          </AuthGuard>
        </AuthProvider>
      </body>
    </html>
  );
}

