import type { Metadata } from "next";
import DemoTour from "@/components/demo-tour";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedClear — Understand your medicine",
  description:
    "Clear, calm explanations to help you understand the medicines on your prescription.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <DemoTour />
      </body>
    </html>
  );
}
