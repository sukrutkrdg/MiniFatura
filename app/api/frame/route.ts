import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseClient';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const wallet = searchParams.get('wallet');

  if (!wallet) {
    return new NextResponse('Wallet address required', { status: 400 });
  }

  const { data } = await supabase
    .from('wallet_stats')
    .select('*')
    .eq('wallet_address', wallet)
    .single();

  const totalFee = data?.total_fee || '0 ETH';
  const topCategory = data?.top_category || 'Transfer';

  return new NextResponse(
    `
    <!DOCTYPE html>
    <html>
      <head>
        <meta property="og:title" content="Web3 Fatura Özeti" />
        <meta property="og:image" content="https://yourdomain.com/api/frame-image?fee=${totalFee}&category=${topCategory}" />
        <meta property="fc:frame" content="vNext" />
        <meta property="fc:frame:image" content="https://yourdomain.com/api/frame-image?fee=${totalFee}&category=${topCategory}" />
        <meta property="fc:frame:button:1" content="Detayları Gör" />
        <meta property="fc:frame:button:1:action" content="link" />
        <meta property="fc:frame:button:1:target" content="https://yourdomain.com" />
      </head>
      <body></body>
    </html>
    `,
    { headers: { 'Content-Type': 'text/html' } }
  );
}