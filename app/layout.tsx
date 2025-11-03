export const metadata = {
  title: 'Web3 Fatura Defteri',
  description: 'Zincir üstü harcamalarını takip et',
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