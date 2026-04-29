import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ShipDB Bot",
  description: "Slack bot for querying the ShipOS Pro database",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
