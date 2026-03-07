import type { Metadata } from "next";
import "./globals.css";
import { Sonner } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "Alchemy Admin",
  description: "Alchemy operational console"
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground">
        {children}
        <Sonner />
      </body>
    </html>
  );
}
