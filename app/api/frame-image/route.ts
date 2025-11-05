export const runtime = 'nodejs'; // 🔧 Bu satır Vercel'de zorunlu

import { NextResponse } from 'next/server';
// Vercel uyumlu sürüm — daha hızlı ve native bağımlılık sorunu yok
import { createCanvas } from '@napi-rs/canvas';



export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fee = searchParams.get('fee') || '0 ETH';
  const category = searchParams.get('category') || 'Transfer';

  const width = 1200;
  const height = 630;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // 🔹 Arka plan
  ctx.fillStyle = '#f9fafb';
  ctx.fillRect(0, 0, width, height);

  // 🔹 Başlık
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 64px Arial';
  ctx.fillText('Web3 Fatura Özeti', 60, 120);

  // 🔹 Bilgiler
  ctx.font = '40px Arial';
  ctx.fillText(`Toplam Fee: ${fee}`, 60, 240);
  ctx.fillText(`En Çok Harcama: ${category}`, 60, 320);

  // 🔹 Alt yazı (isteğe bağlı)
  ctx.font = '28px Arial';
  ctx.fillStyle = '#4b5563';
  ctx.fillText('miniFatura.app', 60, 500);

  const buffer = canvas.toBuffer('image/png');

  return new NextResponse(buffer, {
    headers: { 'Content-Type': 'image/png' },
  });
}
