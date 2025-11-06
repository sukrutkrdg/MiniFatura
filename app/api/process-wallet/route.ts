import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseClient'; // Supabase client'ı import et

// Sunucu tarafı API rotası
// Bu kod ASLA tarayıcıya gitmez.

// Zincir tanımlamaları (artık page.tsx yerine burada)
const chains = [
  { name: 'Ethereum', slug: 'eth-mainnet' },
  { name: 'Polygon', slug: 'matic-mainnet' },
  { name: 'Optimism', slug: 'optimism-mainnet' },
  { name: 'Arbitrum', slug: 'arbitrum-mainnet' },
  { name: 'Base', slug: 'base-mainnet' },
];

// Sınıflandırma fonksiyonu (artık page.tsx yerine burada)
function classifyTransaction(tx: any): string {
  const decodedName = tx.decoded?.name?.toLowerCase();
  if (decodedName) {
    if (decodedName.includes('swap')) return 'Swap';
    if (decodedName.includes('approve')) return 'Approve';
    if (decodedName.includes('mint')) return 'Mint';
    if (decodedName.includes('addliquidity')) return 'Liquidity (Add)';
    if (decodedName.includes('removeliquidity')) return 'Liquidity (Remove)';
    if (decodedName.includes('bridge') || decodedName.includes('depositether')) return 'Bridge';
  }
  if (
    tx.log_events?.some(
      (log: any) =>
        log.decoded?.name?.includes('Transfer') &&
        log.sender_contract_decimals === 0
    )
  )
    return 'NFT Trade/Transfer';
  if (decodedName?.includes('transfer')) return 'Transfer';
  return 'Other';
}

// Veri çekme fonksiyonu (artık page.tsx yerine burada)
async function fetchAllTransactions(address: string, chainSlug: string) {
  let page = 0;
  const pageSize = 1000;
  let allItems: any[] = [];
  let hasMore = true;

  // ÖNEMLİ: Anahtar artık 'NEXT_PUBLIC_' ön ekine sahip değil.
  // Bu anahtar SADECE sunucu tarafında erişilebilir.
  const API_KEY = process.env.COVALENT_API_KEY;

  if (!API_KEY) {
    throw new Error('COVALENT_API_KEY sunucu tarafında ayarlanmamış.');
  }

  while (hasMore) {
    const res = await fetch(
      `https://api.covalenthq.com/v1/${chainSlug}/address/${address}/transactions_v2/?page-number=${page}&page-size=${pageSize}&key=${API_KEY}`
    );
    
    if (!res.ok) {
      let errorMessage = res.statusText || `Error Code: ${res.status}`;
      try {
        const errorData = await res.json();
        if (errorData && errorData.error_message) {
          errorMessage = errorData.error_message;
        }
      } catch (e) {
        console.error("Could not parse API error response as JSON", e);
      }
      throw new Error(`Covalent API Error (Chain: ${chainSlug}): ${errorMessage}`);
    }
      
    const data = await res.json();
    if (!data?.data?.items) break;
    allItems = allItems.concat(data.data.items);
    hasMore = data.data.pagination?.has_more || false;
    page++;
  }
  return allItems;
}


// Frontend'den çağrılacak ana API fonksiyonu
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const walletAddress = searchParams.get('address');

  if (!walletAddress) {
    return NextResponse.json({ error: 'Wallet address is required' }, { status: 400 });
  }

  try {
    // 1. Önbelleği (Supabase) Kontrol Et
    const { data: cachedData, error: cacheError } = await supabase
      .from('wallet_stats')
      .select('*')
      .eq('wallet_address', walletAddress)
      .single();

    if (cacheError && cacheError.code !== 'PGRST116') {
       console.error('Supabase read error:', cacheError);
    }
    
    const oneHourAgo = new Date(new Date().getTime() - 60 * 60 * 1000).toISOString();
    if (cachedData && cachedData.updated_at > oneHourAgo) {
      console.log('Using cache (Supabase).');
      // Önbellekten veriyi JSON olarak döndür
      return NextResponse.json({ chainStats: cachedData.chain_stats, source: 'cache' });
    }
    
    console.log('Cache is old or missing. Calling Covalent API...');
    
    // 2. Önbellek yoksa Covalent'i çağır
    const results = await Promise.all(
      chains.map(async (chain) => {
        const items = await fetchAllTransactions(walletAddress, chain.slug);
        
        const categories: Record<string, { totalFeeUSD: number; count: number }> = {};
        
        const feesUSD = items.map((tx: any) => {
          const feeInNativeToken = (Number(tx.fees_paid) || 0) / 1e18;
          const gasRateUSD = tx.gas_quote_rate || 0;
          const feeUSD = feeInNativeToken * gasRateUSD;

          const category = classifyTransaction(tx);
          if (!categories[category])
            categories[category] = { totalFeeUSD: 0, count: 0 };
          categories[category].totalFeeUSD += feeUSD;
          categories[category].count += 1;
          return feeUSD;
        });
        
        const totalFeeUSD = feesUSD.reduce((s, f) => s + f, 0);
        
        return { 
          name: chain.name, 
          totalFeeUSD,
          txCount: items.length, 
          categories 
        };
      })
    );

    const totalFeeUSDAllChains = results.reduce((s, c) => s + c.totalFeeUSD, 0);
    const topCategory = Object.entries(
        results.flatMap(r => Object.entries(r.categories))
               .reduce((acc, [cat, data]) => {
                   if (!acc[cat]) acc[cat] = 0;
                   acc[cat] += data.totalFeeUSD;
                   return acc;
               }, {} as Record<string, number>)
    ).sort(([, feeA], [, feeB]) => feeB - feeA)[0]?.[0] || 'Transfer';

    // 3. Yeni veriyi Supabase'e kaydet (Async, beklemesek de olur)
    supabase.from('wallet_stats').upsert({
      wallet_address: walletAddress,
      total_fee: totalFeeUSDAllChains,
      chain_stats: results,
      updated_at: new Date().toISOString(),
      top_category: topCategory
    }).then(({ error: upsertError }) => {
        if(upsertError) {
            console.error("Supabase upsert error:", upsertError);
        }
    });
    
    // 4. Yeni veriyi frontend'e döndür
    return NextResponse.json({ chainStats: results, source: 'api' });

  } catch (err) {
    console.error('Error processing wallet data:', err);
    const errorMessage = (err instanceof Error) ? err.message : 'An unknown server error occurred';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}