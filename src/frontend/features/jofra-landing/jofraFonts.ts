import { DM_Sans, Manrope } from "next/font/google";

export const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
  preload: false,
  weight: ["400", "500", "600", "700"],
});

export const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
  preload: false,
  weight: ["400", "500", "600", "700", "800"],
});
