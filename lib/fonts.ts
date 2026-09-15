import { Syne, DM_Mono } from "next/font/google";

// Syne ships a variable cut (400–800); one file covers display, subheads and
// body. DM Mono is static — 400 only. Latin subset, swap. See phase-7 spec §2.
export const syne = Syne({
  subsets: ["latin"],
  variable: "--font-syne",
  display: "swap",
});

export const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-dm-mono",
  display: "swap",
});

export const FONT_CLASS = `${syne.variable} ${dmMono.variable}`;
