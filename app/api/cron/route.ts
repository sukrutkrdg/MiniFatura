import { NextResponse, NextRequest } from 'next/server'; // GÜNCELLEME: NextRequest eklendi
import { supabase } from '../../../lib/supabaseClient';

// Bu, Vercel Cron Job'unuz tarafından tetiklenecek
export async function GET(req: NextRequest) { // GÜNCELLEME: 'Request' -> 'NextRequest'
  // Cron Güvenliği:
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('Cron Job Başladı: Tüm cüzdanlar güncelleniyor...');

    // 1. Supabase'den tüm kayıtlı cüzdan adreslerini çek
    const { data: wallets, error } = await supabase
      .from('wallet_stats')
      .select('wallet_address');

    if (error) {
      throw new Error(`Supabase'den cüzdanlar çekilirken hata: ${error.message}`);
    }

    if (!wallets || wallets.length === 0) {
      return NextResponse.json({ message: 'Güncellenecek cüzdan bulunamadı.' });
    }

    const VERCEL_URL = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'http://localhost:3000';

    // 2. Her cüzdan için veri güncelleme API'sini tetikle (await kullanma)
    wallets.forEach(wallet => {
      fetch(`${VERCEL_URL}/api/process-wallet?address=${wallet.wallet_address}`, {
        method: 'GET',
        headers: {}
      })
      .then(res => res.json())
      .then(data => {
        if(data.error) {
           console.error(`Cron: ${wallet.wallet_address} güncellenemedi: ${data.error}`);
        } else {
           console.log(`Cron: ${wallet.wallet_address} başarıyla tetiklendi (Source: ${data.source}).`);
        }
      })
      .catch(err => {
        console.error(`Cron: ${wallet.wallet_address} tetiklenirken fetch hatası:`, err);
      });
    });

    return NextResponse.json({ message: `${wallets.length} cüzdan için güncelleme tetiklendi.` });

  } catch (err) {
    console.error('Cron job hatası:', err);
    const errorMessage = (err instanceof Error) ? err.message : 'Bilinmeyen cron hatası';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}