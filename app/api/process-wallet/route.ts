import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseClient';

// Zincir tanımlamaları
const chains = [
  { name: 'Ethereum', slug: 'eth-mainnet' },
  { name: 'Polygon', slug: 'matic-mainnet' },
  { name: 'Optimism', slug: 'optimism-mainnet' },
  { name: 'Arbitrum', slug: 'arbitrum-mainnet' },
  { name: 'Base', slug: 'base-mainnet' },
];

// Sınıflandırma fonksiyonu
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

// Covalent'ten veri çeken fonksiyon
async function fetchChainTransactions(address: string, chainSlug: string) {
  let page = 0;
  const pageSize = 1000;
  let allItems: any[] = [];
  let hasMore = true;

  const API_KEY = process.env.COVALENT_API_KEY;

  if (!API_KEY) {
    throw new Error('COVALENT_API_KEY is not set on the server.');
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

// İşlem verisini işleyen ana fonksiyon
function processTransactions(items: any[]) {
  const categories: Record<string, { totalFeeUSD: number; count: number }> = {};
  const transactions: { feeUSD: number; tx_hash: string; date: string; category: string }[] = [];

  items.forEach((tx: any) => {
    const feeInNativeToken = (Number(tx.fees_paid) || 0) / 1e18;
    const gasRateUSD = tx.gas_quote_rate || 0;
    const feeUSD = feeInNativeToken * gasRateUSD;
    
    const category = classifyTransaction(tx);
    if (!categories[category]) {
      categories[category] = { totalFeeUSD: 0, count: 0 };
    }
    categories[category].totalFeeUSD += feeUSD;
    categories[category].count += 1;

    transactions.push({
      feeUSD,
      tx_hash: tx.tx_hash,
      date: tx.block_signed_at,
      category,
    });
  });

  const totalFeeUSD = transactions.reduce((s, f) => s + f.feeUSD, 0);
  
  // Madde 2: En maliyetli 10 işlemi bul
  const topTransactions = transactions
    .sort((a, b) => b.feeUSD - a.feeUSD)
    .slice(0, 10);
  
  return {
    totalFeeUSD,
    txCount: items.length,
    categories,
    topTransactions,
  };
}

// Frontend'den çağrılacak ana API fonksiyonu
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const walletAddress = searchParams.get('address');
  const daysFilter = searchParams.get('days'); // Madde 3: Tarih filtresini al

  if (!walletAddress) {
    return NextResponse.json({ error: 'Wallet address is required' }, { status: 400 });
  }

  try {
    // 1. Önbelleği (Supabase) Kontrol Et (Cache HER ZAMAN tüm zamanları tutar)
    const { data: cachedData, error: cacheError } = await supabase
      .from('wallet_stats')
      .select('chain_stats_all_time, updated_at') // Sadece tüm zamanlar verisini çek
      .eq('wallet_address', walletAddress)
      .single();

    if (cacheError && cacheError.code !== 'PGRST116') {
       console.error('Supabase read error:', cacheError);
    }
    
    let allTimeStats: any[] = [];
    const oneHourAgo = new Date(new Date().getTime() - 60 * 60 * 1000).toISOString();

    if (cachedData && cachedData.updated_at > oneHourAgo) {
      console.log('Using cache (Supabase).');
      allTimeStats = cachedData.chain_stats_all_time;
    } else {
      console.log('Cache is old or missing. Calling Covalent API...');
      
      // 2. Önbellek yoksa Covalent'i çağır
      // Madde 4: Promise.all -> Promise.allSettled
      const promises = chains.map(chain => 
        fetchChainTransactions(walletAddress, chain.slug)
          .then(items => ({
            name: chain.name,
            ...processTransactions(items) // İşlemeyi de burada yap
          }))
      );
      
      const results = await Promise.allSettled(promises);
      
      // Başarılı ve başarısız olanları ayır
      const successfulChains = results
        .filter(r => r.status === 'fulfilled')
        .map(r => (r as PromiseFulfilledResult<any>).value);
        
      const failedChains = results
        .filter(r => r.status === 'rejected')
        .map((r, index) => ({
            name: chains[index].name,
            reason: (r as PromiseRejectedResult).reason.message
        }));

      if (successfulChains.length === 0) {
        throw new Error(`All chains failed to fetch. Last error: ${failedChains[0]?.reason || 'Unknown error'}`);
      }
      
      allTimeStats = successfulChains;
      
      // 3. Yeni veriyi Supabase'e kaydet (Tüm zamanlar)
      // Not: Başarısız zincirler cache'e dahil edilmez.
      const totalFeeUSDAllChains = successfulChains.reduce((s, c) => s + c.totalFeeUSD, 0);
      const topCategory = Object.entries(
          successfulChains.flatMap(r => Object.entries(r.categories as Record<string, { totalFeeUSD: number; count: number }>))
                 .reduce((acc, [cat, data]) => {
                     if (!acc[cat]) acc[cat] = 0;
                     acc[cat] += data.totalFeeUSD;
                     return acc;
                 }, {} as Record<string, number>)
      ).sort(([, feeA], [, feeB]) => feeB - feeA)[0]?.[0] || 'Transfer';

      supabase.from('wallet_stats').upsert({
        wallet_address: walletAddress,
        total_fee: totalFeeUSDAllChains, // Bu artık sadece başarılı olanların toplamı
        chain_stats_all_time: successfulChains, // 'chain_stats' -> 'chain_stats_all_time'
        updated_at: new Date().toISOString(),
        top_category: topCategory
      }).then(({ error: upsertError }) => {
          if(upsertError) {
              console.error("Supabase upsert error:", upsertError);
          }
      });
      
      // Hata varsa, bu hataları da frontend'e yolla
      if (failedChains.length > 0) {
         return NextResponse.json({ 
           chainStats: successfulChains, // Başarılı olanları yine de gönder
           failedChains: failedChains.map(f => f.name), // Hangi zincirlerin patladığını söyle
           source: 'api-partial' 
         });
      }
    }

    // 4. Madde 3: Tarih Filtresini uygula
    // Veri ister cache'ten ister API'den gelsin, 'allTimeStats' üzerinde filtreleme yap
    if (daysFilter && daysFilter !== 'all') {
      const dateLimit = new Date(new Date().getTime() - (Number(daysFilter) * 24 * 60 * 60 * 1000));
      
      const filteredStats = allTimeStats.map(chainStat => {
        // 'items' verisi artık sunucuda kalıyor, sadece 'topTransactions' üzerinden filtreleme yapamayız.
        // Bu, mimari bir değişiklik gerektirir. 'items'ı cache'lemeliyiz.
        
        // Düzeltme: 'items' verisini 'chain_stats_all_time' içinde saklamamız gerekiyor.
        // Bu, Supabase'deki yükü artırır.
        
        // DAHA İYİ YÖNTEM: Covalent API'sini tekrar çağıracağız ama 'days' parametresiyle.
        // Bu, cache mantığını bozar.
        
        // EN İYİ YÖNTEM (Şimdilik): Frontend'e 'allTimeStats'ı gönder, frontend filtrelesin.
        // Hayır, bu çok fazla veri transferi demek.
        
        // KARAR: API rotası filtrelemeyi desteklemeli.
        // Cache'i 'days' parametresine göre ayırmak çok karmaşık.
        // Cache'i *kullanmayacağız* eğer 'days' filtresi varsa. Bu en basit çözüm.
        
        // --- YUKARIDAKİ TÜM CACHE MANTIĞINI GÜNCELLİYORUM ---
        
        // 1. Cache'i SADECE 'all' (tüm zamanlar) için kullan.
        // 2. Eğer 'days' filtresi varsa, cache'i ATLA ve Covalent'i ÇAĞIR.
        // 3. Gelen veriyi (items) sunucuda filtrele.
        // 4. İşle ve döndür. Cache'e YAZMA (çünkü bu kısmi veri).
        
        throw new Error("Tarih filtreleme bu akışta henüz uygulanmadı."); // Bu kısmı yeniden yazacağız.
      });
      
      // return NextResponse.json({ chainStats: filteredStats, source: 'cache-filtered' });
    }

    // 4. Yeni veriyi (veya cache'lenmiş veriyi) frontend'e döndür
    return NextResponse.json({ chainStats: allTimeStats, failedChains: [], source: 'cache' });

  } catch (err) {
    console.error('Error processing wallet data:', err);
    const errorMessage = (err instanceof Error) ? err.message : 'An unknown server error occurred';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// ------ YENİDEN YAZILMIŞ TAM DOSYA (TÜM MADDELERİ DESTEKLEYEN) ------

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const walletAddress = searchParams.get('address');
  const daysFilter = searchParams.get('days'); // Madde 3: Tarih filtresi
  const useCache = !daysFilter || daysFilter === 'all'; // Sadece 'all' ise cache kullan

  if (!walletAddress) {
    return NextResponse.json({ error: 'Wallet address is required' }, { status: 400 });
  }

  try {
    // 1. Cache Kontrolü (Sadece 'all' filtresi için)
    if (useCache) {
      const { data: cachedData, error: cacheError } = await supabase
        .from('wallet_stats')
        .select('chain_stats_all_time, updated_at')
        .eq('wallet_address', walletAddress)
        .single();

      if (cacheError && cacheError.code !== 'PGRST116') console.error('Supabase read error:', cacheError);
      
      const oneHourAgo = new Date(new Date().getTime() - 60 * 60 * 1000).toISOString();
      if (cachedData && cachedData.updated_at > oneHourAgo) {
        console.log('Using cache (Supabase).');
        return NextResponse.json({ 
          chainStats: cachedData.chain_stats_all_time, 
          failedChains: [], 
          source: 'cache' 
        });
      }
    }
    
    console.log(`Cache bypassed or old (Filter: ${daysFilter}). Calling Covalent API...`);
    
    // 2. Covalent API Çağrısı (Madde 4: Promise.allSettled)
    const promises = chains.map(async (chain) => {
      const items = await fetchChainTransactions(walletAddress, chain.slug);
      
      // Madde 3: Tarih Filtreleme
      let filteredItems = items;
      if (daysFilter && daysFilter !== 'all') {
        const dateLimit = new Date(new Date().getTime() - (Number(daysFilter) * 24 * 60 * 60 * 1000));
        filteredItems = items.filter(tx => new Date(tx.block_signed_at) > dateLimit);
      }
      
      // Madde 2: İşlem verisini işle (toplam, kategoriler, top 10 tx)
      const processedData = processTransactions(filteredItems);
      
      return {
        name: chain.name,
        ...processedData
      };
    });

    const results = await Promise.allSettled(promises);
    
    const successfulChains = results
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<any>).value);
      
    const failedChains = results
      .filter(r => r.status === 'rejected')
      .map((r, index) => chains[index].name); // Sadece isimleri döndür

    if (successfulChains.length === 0) {
      const firstError = (results[0] as PromiseRejectedResult).reason.message;
      throw new Error(`All chains failed to fetch. Last error: ${firstError || 'Unknown error'}`);
    }

    // 3. Cache Güncelleme (Sadece 'all' filtresi çalıştıysa ve başarılıysa)
    if (useCache && successfulChains.length > 0) {
      const totalFeeUSDAllChains = successfulChains.reduce((s, c) => s + c.totalFeeUSD, 0);
      const topCategory = Object.entries(
          successfulChains.flatMap(r => Object.entries(r.categories as Record<string, { totalFeeUSD: number; count: number }>))
                 .reduce((acc, [cat, data]) => {
                     if (!acc[cat]) acc[cat] = 0;
                     acc[cat] += data.totalFeeUSD;
                     return acc;
                 }, {} as Record<string, number>)
      ).sort(([, feeA], [, feeB]) => feeB - feeA)[0]?.[0] || 'Transfer';

      supabase.from('wallet_stats').upsert({
        wallet_address: walletAddress,
        total_fee: totalFeeUSDAllChains,
        chain_stats_all_time: successfulChains, // 'allTimeStats'ı kaydet
        updated_at: new Date().toISOString(),
        top_category: topCategory
      }).then(({ error: upsertError }) => {
          if(upsertError) console.error("Supabase upsert error:", upsertError);
          else console.log("Cache updated successfully.");
      });
    }

    // 4. Veriyi Frontend'e Döndür
    return NextResponse.json({ 
      chainStats: successfulChains, 
      failedChains: failedChains, 
      source: 'api' 
    });

  } catch (err) {
    console.error('Error processing wallet data:', err);
    const errorMessage = (err instanceof Error) ? err.message : 'An unknown server error occurred';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}