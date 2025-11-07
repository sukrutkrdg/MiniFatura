import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '../../../lib/supabaseClient';

interface TopTx {
  tx_hash: string;
  feeUSD: number;
  feeNative: number;
  category: string;
  date: string;
}

interface ChainStat {
  name: string;
  totalFeeUSD: number;
  totalFeeNative: number;
  txCount: number;
  categories: Record<string, { totalFeeUSD: number; count: number }>;
  topTransactions: TopTx[];
}

const chains = [
  { name: 'Ethereum', slug: 'eth-mainnet' },
  { name: 'Polygon', slug: 'matic-mainnet' },
  { name: 'Optimism', slug: 'optimism-mainnet' },
  { name: 'Arbitrum', slug: 'arbitrum-mainnet' },
  { name: 'Base', slug: 'base-mainnet' },
];

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

// GÜNCELLEME: 'walletAddress' parametredddddddddsi eklendi
function processTransactions(items: any[], walletAddress: string): Omit<ChainStat, 'name'> {
  const categories: Record<string, { totalFeeUSD: number; count: number }> = {};
  const transactions: { feeUSD: number; feeNative: number; tx_hash: string; date: string; category: string }[] = [];
  let totalFeeNative = 0; 

  items.forEach((tx: any) => {
    
    // JSON ÇÖKME DÜZELTMESİ:
    // 'tx.from_address' null olabileceğinden, ?. (optional chaining) ekledik.
    const isSender = tx.from_address?.toLowerCase() === walletAddress.toLowerCase();
    
    let feeInNativeToken = 0;
    let feeUSD = 0;

    if (isSender) {
      feeInNativeToken = (Number(tx.fees_paid) || 0) / 1e18;
      const gasRateUSD = tx.gas_quote_rate || 0;
      feeUSD = feeInNativeToken * gasRateUSD;
      totalFeeNative += feeInNativeToken;
    }

    const category = classifyTransaction(tx);
    if (!categories[category]) {
      categories[category] = { totalFeeUSD: 0, count: 0 };
    }
    categories[category].totalFeeUSD += feeUSD;
    categories[category].count += 1;

    if (feeUSD > 0) {
      transactions.push({
        feeUSD,
        feeNative: feeInNativeToken,
        tx_hash: tx.tx_hash,
        date: tx.block_signed_at,
        category,
      });
    }
  });

  const totalFeeUSD = transactions.reduce((s, f) => s + f.feeUSD, 0);
  
  const topTransactions = transactions
    .sort((a, b) => b.feeUSD - a.feeUSD)
    .slice(0, 10);
  
  return {
    totalFeeUSD,
    totalFeeNative,
    txCount: items.length,
    categories,
    topTransactions,
  };
}


export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const walletAddress = searchParams.get('address');
  const daysFilter = searchParams.get('days');
  const useCache = !daysFilter || daysFilter === 'all';

  if (!walletAddress) {
    return NextResponse.json({ error: 'Wallet address is required' }, { status: 400 });
  }

  try {
    // 1. Cache Kontrolü
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
    
    // 2. Covalent API Çağrısı
    const promises = chains.map(async (chain) => {
      const items = await fetchChainTransactions(walletAddress, chain.slug);
      
      let filteredItems = items;
      if (daysFilter && daysFilter !== 'all') {
        const dateLimit = new Date(new Date().getTime() - (Number(daysFilter) * 24 * 60 * 60 * 1000));
        filteredItems = items.filter(tx => new Date(tx.block_signed_at) > dateLimit);
      }
      
      const processedData = processTransactions(filteredItems, walletAddress);
      
      return {
        name: chain.name,
        ...processedData
      };
    });

    const results = await Promise.allSettled(promises);
    
    const successfulChains: ChainStat[] = [];
    const failedChains: string[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successfulChains.push(result.value);
      } else {
        failedChains.push(chains[index].name);
        console.error(`Error processing chain ${chains[index].name}:`, result.reason);
      }
    });

    if (successfulChains.length === 0) {
      const firstError = (results.find(r => r.status === 'rejected') as PromiseRejectedResult)?.reason.message;
      throw new Error(`All chains failed to fetch. Last error: ${firstError || 'Unknown error'}`);
    }

    // 3. Cache Güncelleme
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
        chain_stats_all_time: successfulChains,
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