'use client';

import '@rainbow-me/rainbowkit/styles.css';
import {
  getDefaultConfig,
  RainbowKitProvider,
  ConnectButton,
} from '@rainbow-me/rainbowkit';
import { WagmiProvider, useAccount } from 'wagmi';
import { mainnet, polygon, optimism, arbitrum, base } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Bar, Pie } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from 'chart.js';
import { supabase } from '../lib/supabaseClient';
import { frameHost } from '@farcaster/frame-sdk';

// ✅ Chart.js setup
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement);

// ✅ RainbowKit Config
const config = getDefaultConfig({
  appName: 'WalletFee Tracker',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
  chains: [mainnet, polygon, optimism, arbitrum, base],
  ssr: true,
});

const queryClient = new QueryClient();

// ✅ Mobil wallet deep link templates
const WALLET_LINKS: Record<string, string> = {
  metamask: 'https://metamask.app.link/wc?uri=',
  trust: 'https://link.trustwallet.com/wc?uri=',
  okx: 'okxwallet://wc?uri=',
  coinbase: 'https://go.cb-w.com/wc?uri=',
};

// ✅ Basit mobil kontrolü
function isMobile() {
  if (typeof navigator === 'undefined') return false;
  return /Mobi|Android/i.test(navigator.userAgent);
}

// ✅ Farcaster frame fix
async function initFrame() {
  try {
    const host = frameHost as any;
    if (host && typeof host.ready === 'function') {
      await host.ready();
      console.log('✅ frameHost.ready() başarılı.');
    } else if (host?.actions?.ready) {
      await host.actions.ready();
      console.log('✅ frameHost.actions.ready() başarılı.');
    } else {
      console.log('🌐 Web ortamı.');
    }
  } catch (e) {
    console.error('❌ Frame init hatası:', e);
  }
}

// GÜNCELLEME (Madde 3): Arayüzü USD ve daha fazla kategori gösterecek şekilde güncelledik.
interface ChainStat {
  name: string;
  totalFeeUSD: number; // totalFee -> totalFeeUSD
  txCount: number;
  // fees: number[]; // Bu artık kullanılmayacak (Madde 5)
  categories: Record<string, { totalFeeUSD: number; count: number }>; // totalFee -> totalFeeUSD
}

function Dashboard() {
  const { address, isConnected } = useAccount();
  const [chainStats, setChainStats] = useState<ChainStat[]>([]);
  const [selectedChain, setSelectedChain] = useState('Ethereum');
  const [loading, setLoading] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  
  // GÜNCELLEME (Madde 5): Hata yönetimi için state eklendi.
  const [error, setError] = useState<string | null>(null);
  
  // GÜNCELLEME (Madde 3): Zincir listesi USD hesaplaması için chainId ve nativeCurrency içerecek şekilde güncellendi.
  // Covalent API v3 (v2 yönlendirmesi) `fees_paid_usd` sağladığı için buna şimdilik gerek kalmadı,
  // ancak gelecekte manuel hesaplama gerekirse bu yapı faydalı olur.
  const chains = [
    { name: 'Ethereum', slug: 'eth-mainnet' },
    { name: 'Polygon', slug: 'polygon-mainnet' },
    { name: 'Optimism', slug: 'optimism-mainnet' },
    { name: 'Arbitrum', slug: 'arbitrum-mainnet' },
    { name: 'Base', slug: 'base-mainnet' },
  ];

  useEffect(() => {
    initFrame();
  }, []);

  // GÜNCELLEME (Madde 3): Kategori sınıflandırması daha detaylı hale getirildi.
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
    
    return 'Other'; // Diğer/Bilinmeyen
  }

  async function fetchAllTransactions(address: string, chainSlug: string) {
    let page = 0;
    const pageSize = 1000;
    let allItems: any[] = [];
    let hasMore = true;

    while (hasMore) {
      const res = await fetch(
        `https://api.covalenthq.com/v1/${chainSlug}/address/${address}/transactions_v2/?page-number=${page}&page-size=${pageSize}&key=${process.env.NEXT_PUBLIC_COVALENT_API_KEY}`
      );
      
      // GÜNCELLEME (Madde 5): API'den başarısız yanıt gelirse hata fırlat
      if (!res.ok) {
        throw new Error(`Covalent API hatası (Chain: ${chainSlug}): ${res.statusText}`);
      }
        
      const data = await res.json();
      if (!data?.data?.items) break;
      allItems = allItems.concat(data.data.items);
      hasMore = data.data.pagination?.has_more || false;
      page++;
    }

    return allItems;
  }

  useEffect(() => {
    if (!isConnected || !address) return;

    const fetchData = async () => {
      setLoading(true);
      setError(null); // GÜNCELLEME (Madde 5): Hata mesajını sıfırla

      try {
        // GÜNCELLEME (Madde 2): Performans için önbellek kontrolü
        const { data: cachedData, error: cacheError } = await supabase
          .from('wallet_stats')
          .select('*')
          .eq('wallet_address', address)
          .single();

        if (cacheError && cacheError.code !== 'PGRST116') { // 'PGRST116' = no rows found
           console.error('Supabase okuma hatası:', cacheError);
           // Hata olsa bile devam et, veriyi yeniden çek
        }
        
        // Veri varsa ve 1 saatten yeniyse, API'yi çağırma
        const oneHourAgo = new Date(new Date().getTime() - 60 * 60 * 1000).toISOString();
        if (cachedData && cachedData.updated_at > oneHourAgo) {
          console.log('Cache (Supabase) kullanılıyor.');
          setChainStats(cachedData.chain_stats);
          setLoading(false);
          return;
        }
        
        console.log('Cache eski veya yok. Covalent API çağrılıyor...');
        // GÜNCELLEME (Madde 2) Bitiş
        
        const results = await Promise.all(
          chains.map(async (chain) => {
            const items = await fetchAllTransactions(address, chain.slug);
            
            // GÜNCELLEME (Madde 3): USD ve Kategori hesaplaması güncellendi
            const categories: Record<string, { totalFeeUSD: number; count: number }> = {};
            
            const feesUSD = items.map((tx: any) => {
              // Covalent v3 (v2 yönlendirmesi) 'fees_paid_usd' sağlar. 
              // Bu, ETH/MATIC/vb. dönüşümünü otomatik yapar.
              const feeUSD = tx.fees_paid_usd || 0; 
              
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
              totalFeeUSD, // totalFee -> totalFeeUSD
              txCount: items.length, 
              // fees: feesUSD, // (Madde 5) Bu grafiği kaldırdığımız için artık state'e yüklemeye gerek yok
              categories 
            };
          })
        );
        // GÜNCELLEME (Madde 3) Bitiş

        setChainStats(results);

        // GÜNCELLEME (Madde 3): Toplam harcama USD'ye göre hesaplanıyor
        const totalFeeUSDAllChains = results.reduce((s, c) => s + c.totalFeeUSD, 0);

        await supabase.from('wallet_stats').upsert({
          wallet_address: address,
          total_fee: totalFeeUSDAllChains, // Artık USD cinsinden toplam
          chain_stats: results,
          updated_at: new Date().toISOString(),
          
          // GÜNCELLEME (Madde 4) için 'top_category' eklendi
          top_category: Object.entries(
              results.flatMap(r => Object.entries(r.categories))
                     .reduce((acc, [cat, data]) => {
                         if (!acc[cat]) acc[cat] = 0;
                         acc[cat] += data.totalFeeUSD;
                         return acc;
                     }, {} as Record<string, number>)
          ).sort(([, feeA], [, feeB]) => feeB - feeA)[0]?.[0] || 'Transfer'
        });
        
      } catch (err) {
        console.error('Veri çekme hatası:', err);
        // GÜNCELLEME (Madde 5): Hata yönetimi
        if (err instanceof Error) {
            setError(`Veri çekilirken bir hata oluştu: ${err.message}. Lütfen daha sonra tekrar deneyin.`);
        } else {
            setError('Bilinmeyen bir hata oluştu.');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [address, isConnected]); // 'chains' bağımlılığını kaldırdık, artık sabit.

  const selectedData = chainStats.find((s) => s.name === selectedChain);

  // GÜNCELLEME (Madde 5): Bu grafik kaldırıldı.
  /*
  const chartData = {
    labels: selectedData ? selectedData.fees.map((_, i) => `Tx ${i + 1}`) : [],
    datasets: [
      {
        label: 'Fee (USD)', // ETH -> USD
        data: selectedData ? selectedData.fees : [],
        backgroundColor: 'rgba(99,102,241,0.6)',
      },
    ],
  };
  */

  // GÜNCELLEME (Madde 3): Grafik USD'ye güncellendi
  const chainChartData = {
    labels: chainStats.map((c) => c.name),
    datasets: [
      {
        label: 'Total Fee (USD)', // ETH -> USD
        data: chainStats.map((c) => c.totalFeeUSD), // totalFee -> totalFeeUSD
        backgroundColor: 'rgba(147,51,234,0.6)',
      },
    ],
  };

  // GÜNCELLEME (Madde 3): Grafik USD'ye güncellendi
  const categoryChartData = {
    labels: selectedData ? Object.keys(selectedData.categories) : [],
    datasets: [
      {
        label: 'Category Spending (USD)', // ETH -> USD
        data: selectedData
          ? Object.values(selectedData.categories).map((v) => v.totalFeeUSD) // totalFee -> totalFeeUSD
          : [],
        backgroundColor: ['#4F46E5', '#EC4899', '#10B981', '#F59E0B', '#F97316', '#6B7280'], // GÜNCELLEME (Madde 3): Yeni kategoriler için renkler eklendi
      },
    ],
  };

  const handleWalletClick = (wallet: keyof typeof WALLET_LINKS) => {
    const wcUri = encodeURIComponent(window.location.href);
    const deepLink = `${WALLET_LINKS[wallet]}${wcUri}`;
    window.location.href = deepLink;
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-50">
      <h1 className="text-3xl font-bold mb-6 text-indigo-700">Wallet Fee Tracker</h1>

      {/* ... (Mobil wallet modal kısmı aynı kaldı) ... */}
      {isMobile() ? (
         // ... (mevcut mobil kodunuz) ...
          <>
          <button
            onClick={() => setShowWalletModal(true)}
            className="bg-indigo-600 text-white px-6 py-3 rounded-xl shadow-md hover:bg-indigo-700 transition"
          >
            Cüzdanını Bağla
          </button>

          {showWalletModal && (
            <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50">
              <div className="bg-white w-full rounded-t-2xl p-6 shadow-lg">
                <h2 className="text-lg font-semibold text-center mb-4">
                  Cüzdanını Seç
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  {Object.keys(WALLET_LINKS).map((wallet) => (
                    <button
                      key={wallet}
                      onClick={() => handleWalletClick(wallet as keyof typeof WALLET_LINKS)}
                      className="border rounded-xl p-3 text-sm font-medium hover:bg-indigo-50 transition"
                    >
                      {wallet.charAt(0).toUpperCase() + wallet.slice(1)} Wallet
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setShowWalletModal(false)}
                  className="mt-4 w-full text-center text-gray-500"
                >
                  Kapat
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <ConnectButton />
      )}
      {/* ... (Mobil wallet modal kısmı bitti) ... */}

      {isConnected && (
        <div className="mt-6 w-full max-w-3xl">
          {loading ? (
            <div className="flex flex-col items-center">
              <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-indigo-500 mb-4"></div>
              <p>İşlem verileri çekiliyor...</p>
              <p className="text-sm text-gray-500">(İlk seferde bu işlem cüzdan yoğunluğuna göre birkaç dakika sürebilir)</p>
            </div>
          // GÜNCELLEME (Madde 5): Hata mesajı UI'da gösteriliyor
          ) : error ? (
            <div className="text-center p-4 bg-red-100 text-red-700 rounded-lg">
                <p><strong>Hata!</strong></p>
                <p>{error}</p>
            </div>
          ) : (
            <>
              <div className="mt-4">
                <label className="mr-2">Zincir Seç:</label>
                <select
                  value={selectedChain}
                  onChange={(e) => setSelectedChain(e.target.value)}
                  className="border p-2 rounded"
                >
                  {chains.map((chain) => (
                    <option key={chain.name} value={chain.name}>
                      {chain.name}
                    </option>
                  ))}
                </select>
              </div>

              {selectedData && (
                <>
                  <p className="mt-4">
                    {/* GÜNCELLEME (Madde 3): ETH -> USD */}
                    Toplam Harcama ({selectedData.name}):{' '}
                    <strong>${selectedData.totalFeeUSD.toFixed(2)} USD</strong>
                  </p>
                  <p>
                    Toplam İşlem: <strong>{selectedData.txCount}</strong>
                  </p>
                  
                  {/* GÜNCELLEME (Madde 5): Bu grafik çok fazla veri içerdiği ve UI'ı bozduğu için kaldırıldı.
                  <Bar data={chartData} className="mt-4" />
                  */}
                  
                  <h2 className="text-lg font-semibold mt-8">{selectedData.name} - Kategoriye Göre Harcama</h2>
                  <Pie data={categoryChartData} className="mt-6" />
                </>
              )}

              <h2 className="text-lg font-semibold mt-8">Zincirlere Göre Toplam Harcama (USD)</h2>
              <Bar data={chainChartData} className="mt-2" />
            </>
          )}
        </div>
      )}
    </main>
  );
}

export default function Page() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <Dashboard />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}