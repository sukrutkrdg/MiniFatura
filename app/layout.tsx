import './globals.css';

export const metadata = {
  title: 'WalletFee',
  description: 'Track total transaction fee spending across your wallets across multiple blockchains',
  other: {
    'fc:frame': JSON.stringify({
      version: 'vNext',
      name: 'WalletFee',
      iconUrl: 'https://mini-fatura.vercel.app/icon.png',
      homeUrl: 'https://mini-fatura.vercel.app',
      imageUrl: 'https://mini-fatura.vercel.app/image.png',
      splashImageUrl: 'https://mini-fatura.vercel.app/splash.png',
      splashBackgroundColor: '#6200EA',
      subtitle: 'Wallet Fee',
      description: 'Track total transaction fee spending across your wallets across multiple blockchains',
    }),
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
