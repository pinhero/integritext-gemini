import './globals.css';

export const metadata = {
  title: 'Kelly — Détection IA & Plagiat',
  description: 'Analyse sémantique pour détecter les textes générés par IA et le plagiat.',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.ico',
    apple: '/favicon.ico',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <head>
        <link rel="icon" href="/favicon.ico" type="image/svg+xml" />
      </head>
      <body>{children}</body>
    </html>
  );
}
