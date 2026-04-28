import type { Metadata } from "next";
import "./globals.css";
import Header from "./components/layout/Header";
import Footer from "./components/layout/Footer";
import { ThemeProvider } from "./components/layout/ThemeProvider";

export const metadata: Metadata = {
  title: "EnduroLab — Marathon Training Planner",
  description: "Science-backed marathon training plans built around your goals, pace zones, and available training days.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
        <div className="flex min-h-screen flex-col">
          <Header />
          <ThemeProvider>
            <main className="flex-1">{children}</main>
          </ThemeProvider>
        </div>
        <Footer />
      </body>
    </html>
  );
}
