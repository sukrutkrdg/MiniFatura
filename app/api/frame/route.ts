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

  const totalFee = data?.total_fee ? `$${data.total_fee.toFixed(2)} USD` : 'No Data';
  const topCategory = data?.top_category || 'N/A';
  
  const baseUrl = 'https://mini-fatura.vercel.app'; // Burayı kendi Vercel URL'niz ile değiştirin

  return new NextResponse(
    `
    <!DOCTYPE html>
    <html>
      <head>
        <meta property="og:title" content="Web3 Fee Summary" />
        <meta property="og:image" content="${baseUrl}/api/frame-image?fee=${encodeURIComponent(totalFee)}&category=${encodeURIComponent(topCategory)}" />
        <meta property="fc:frame" content="vNext" />
        <meta property="fc:frame:image" content="${baseUrl}/api/frame-image?fee=${encodeURIComponent(totalFee)}&category=${encodeURIComponent(topCategory)}" />
        <meta property="fc:frame:button:1" content="See Your Spend" /> 
        <meta property="fc:frame:button:1:action" content="link" />
        <meta property="fc:frame:button:1:target" content="${baseUrl}" />
      </head>
      <body></body>
    </html>
    `,
    { headers: { 'Content-Type': 'text/html' } }
  );
}