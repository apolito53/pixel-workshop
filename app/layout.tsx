import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pixel Workshop",
  description: "A little room to make things. Draw precise pixel art with a shared browser and MCP canvas.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
