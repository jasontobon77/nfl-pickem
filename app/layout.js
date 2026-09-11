import { Bebas_Neue, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const bebas = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata = {
  title: "Family Pick'Em",
  description: "Weekly NFL Pick'Em pool — make your picks, track the standings.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${bebas.variable} ${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
