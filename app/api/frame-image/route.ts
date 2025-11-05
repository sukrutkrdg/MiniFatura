import { NextResponse } from 'next/server';
import { createCanvas } from 'canvas';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fee = searchParams.get('fee') || '0 ETH';
  const category = searchParams.get('category') || 'Transfer';

  const width = 1200;
  const height = 630;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f9fafb';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#111827';
  ctx.font = 'bold 48px sans-serif';
  ctx.fillText('Web3 Fatura Özeti', 50, 100);

  ctx.font = '36px sans-serif';
  ctx.fillText(`Toplam Fee: ${fee}`, 50, 200);
  ctx.fillText(`En Çok Harcama: ${category}`, 50, 280);

  const buffer = canvas.toBuffer('image/png');
  return new NextResponse(buffer, {
    headers: { 'Content-Type': 'image/png' },
  });
}