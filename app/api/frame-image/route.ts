import { NextResponse } from 'next/server';

export const runtime = 'edge'; // Edge uyumlu

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fee = searchParams.get('fee') || '$0.00 USD';
  const category = searchParams.get('category') || 'Bilinmiyor';

  let title = "Web3 Fatura Özeti";
  let feeText = `Toplam Harcama: ${fee}`;
  let categoryText = `En Çok Harcama: ${category}`;

  // GÜNCELLEME (Madde 4): Veri yoksa gösterilecek özel mesaj
  if (fee === 'Veri Yok') {
    title = "Fee Tracker'a Hoş Geldiniz!";
    feeText = "Cüzdan harcamalarınızı hesaplamak için";
    categoryText = "Uygulamayı ziyaret edin ve cüzdanınızı bağlayın.";
  }

  const svg = `
  <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f9fafb"/>
    <text x="50" y="100" font-size="60" font-weight="bold" fill="#111827">${title}</text>
    <text x="50" y="220" font-size="48" fill="#111827">${feeText}</text>
    <text x="50" y="300" font-size="48" fill="#111827">${categoryText}</text>
    <text x="50" y="580" font-size="30" fill="#6B7280">mini-fatura.vercel.app</text>
  </svg>`;

  return new NextResponse(svg, {
    headers: { 'Content-Type': 'image/svg+xml' },
  });
}