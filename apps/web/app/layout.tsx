import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { LiveProvider } from "@/lib/live";

export const metadata: Metadata = {
  title: "Mandate control tower",
  description: "Owner console for the Mandate wallet agent. Testnet only.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LiveProvider>
          <div className="flex min-h-screen">
            <Nav />
            <main className="flex-1 p-6 max-w-[1400px]">{children}</main>
          </div>
        </LiveProvider>
      </body>
    </html>
  );
}
