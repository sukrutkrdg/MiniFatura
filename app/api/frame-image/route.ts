import { NextResponse } from 'next/server';

export const runtime = 'edge'; // Edge uyumlu

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fee = searchParams.get('fee') || '0 ETH';
  const category = searchParams.get('category') || 'Transfer';

  const svg = `
  <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f9fafb"/>
    <text x="50" y="100" font-size="48" font-weight="bold" fill="#111827">Web3 Fatura Özeti</text>
    <text x="50" y="200" font-size="36" fill="#111827">Toplam Fee: ${fee}</text>
    <text x="50" y="280" font-size="36" fill="#111827">En Çok Harcama: ${category}</text>
  </svg>`;

  return new NextResponse(svg, {
    headers: { 'Content-Type': 'image/svg+xml' },
  });
}
