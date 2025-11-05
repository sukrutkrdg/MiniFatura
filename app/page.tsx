'use client';

import '@rainbow-me/rainbowkit/styles.css';
import {
  getDefaultConfig,
  RainbowKitProvider,
  ConnectButton,
} from '@rainbow-me/rainbowkit';
import { WagmiProvider, useAccount } from 'wagmi';
import { mainnet, polygon, optimism, arbitrum } from 'wagmi/chains';
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

// Farcaster Mini App SDK Import'u buraya eklendi
// (npm install @farcaster/miniapp-sdk paketini kurduğunuz varsayılmıştır)
import { sdk } from '@farcaster/miniapp-sdk'; 

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement);

interface ChainStat {
  name: string;
  totalFee: number;
  txCount: number;
  fees: number[];
  categories: Record<string, { totalFee: number; count: number }>;
}

const config = getDefaultConfig({
  appName: 'Web3 Fatura Defteri',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
  chains: [mainnet, polygon, optimism, arbitrum],
});

const queryClient = new QueryClient();

function Dashboard() {
  const { address, isConnected } = useAccount();
  const [selectedChain, setSelectedChain] = useState<string>('Ethereum');
  const [chainStats, setChainStats] = useState<ChainStat[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  // ⬇️ YENİ EKLENEN KOD BLOKLARI: Farcaster Ready Sinyali ⬇️
  useEffect(() => {
    // Sadece tarayıcıda tanımlıysa ve bir iframe içinde (Mini App) çalışıyorsa ready çağrısını yap.
    if (typeof window !== 'undefined' && window.parent !== window) {
      try {
        if (sdk && sdk.actions && sdk.actions.ready) {
          // Uygulamanın yüklendiğini Farcaster istemcisine bildirir.
          // Bu, splash ekranını kaldırır.
          sdk.actions.ready();
        }
      } catch (e) {
        // SDK yüklenmediyse bile uygulamanın çökmesini engellemek için hata yakalama.
        console.error("Farcaster SDK ready çağrısı sırasında hata oluştu.");
      }
    }
  }, []); // Sadece bir kez, bileşen yüklendiğinde çalışır.
  // ⬆️ YENİ KOD BURADA BİTER ⬆️

  const chains = [
    { name: 'Ethereum', slug: 'eth-mainnet' },
    { name: 'Polygon', slug: 'polygon-mainnet' },
    { name: 'Optimism', slug: 'optimism-mainnet' },
    { name: 'Arbitrum', slug: 'arbitrum-mainnet' },
  ];

  function classifyTransaction(tx: any): string {
    if (tx.decoded && tx.decoded.name?.toLowerCase().includes('swap')) return 'Swap';
    if (
      tx.log_events?.some(
        (log: any) =>
          log.decoded?.name?.includes('Transfer') && log.sender_contract_decimals === 0
      )
    )
      return 'NFT Trade';
    return 'Transfer';
  }

  const fetchAllTransactions = async (address: string, chainSlug: string) => {
    let page = 0;
    const pageSize = 1000;
    let allItems: any[] = [];
    let hasMore = true;

    while (hasMore) {
      const res = await fetch(
        `https://api.covalenthq.com/v1/${chainSlug}/address/${address}/transactions_v2/?page-number=${page}&page-size=${pageSize}&key=${process.env.NEXT_PUBLIC_COVALENT_API_KEY}`
      );
      const data = await res.json();

      if (!data || !data.data || !data.data.items) {
        console.error(`API yanıtı geçersiz: ${chainSlug}`, data);
        break;
      }

      allItems = allItems.concat(data.data.items);
      hasMore = data.data.pagination?.has_more || false;
      page++;
    }

    return allItems;
  };

  useEffect(() => {
    if (!isConnected || !address) return;

    const fetchChainData = async () => {
      setLoading(true);

      const promises = chains.map(async (chain) => {
        const items = await fetchAllTransactions(address, chain.slug);
        const categories: Record<string, { totalFee: number; count: number }> = {};
        const fees = items.map((tx: any) => {
          const feeEth = (tx.gas_price * tx.gas_spent) / 1e18;
          const category = classifyTransaction(tx);
          if (!categories[category]) categories[category] = { totalFee: 0, count: 0 };
          categories[category].totalFee += feeEth;
          categories[category].count += 1;
          return feeEth;
        });
        const totalFee = fees.reduce((sum: number, fee: number) => sum + fee, 0);

        return { name: chain.name, totalFee, txCount: items.length, fees, categories };
      });

      const results = await Promise.all(promises);
      setChainStats(results);
      setLoading(false);

      // ✅ DB'ye yazma
      const totalFeeAllChains = results.reduce((sum, r) => sum + r.totalFee, 0);
      const avgFeeAllChains =
        totalFeeAllChains / results.reduce((sum, r) => sum + r.txCount, 0);

      const topCategory = Object.entries(results[0].categories)
        .sort((a, b) => b[1].totalFee - a[1].totalFee)[0][0];

      await supabase.from('wallet_stats').upsert({
        wallet_address: address,
        total_fee: totalFeeAllChains,
        avg_fee: avgFeeAllChains,
        top_category: topCategory,
        chain_stats: results,
        updated_at: new Date().toISOString(),
      });
    };

    fetchChainData();
  }, [address, isConnected]);

  const selectedData = chainStats.find((stat) => stat.name === selectedChain);

  const chartData = {
    labels: selectedData ? selectedData.fees.map((_, i) => `Tx ${i + 1}`) : [],
    datasets: [
      {
        label: 'Fee (ETH)',
        data: selectedData ? selectedData.fees : [],
        backgroundColor: 'rgba(75, 192, 192, 0.6)',
      },
    ],
  };

  const chainChartData = {
    labels: chainStats.map((stat) => stat.name),
    datasets: [
      {
        label: 'Toplam Fee (ETH)',
        data: chainStats.map((stat) => stat.totalFee),
        backgroundColor: 'rgba(153, 102, 255, 0.6)',
      },
    ],
  };

  const categoryChartData = {
    labels: selectedData ? Object.keys(selectedData.categories) : [],
    datasets: [
      {
        label: 'Kategori Bazlı Harcama (ETH)',
        data: selectedData
          ? Object.values(selectedData.categories).map((c) => c.totalFee)
          : [],
        backgroundColor: ['#4caf50', '#2196f3', '#ff9800'],
      },
    ],
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-50">
      <h1 className="text-3xl font-bold mb-6">Web3 Fatura Defteri</h1>
      <ConnectButton />
      {isConnected && (
        <div className="mt-6 w-full max-w-3xl">
          {loading ? (
            <div className="flex flex-col items-center">
              <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-blue-500 mb-4"></div>
              <p>Veriler yükleniyor, lütfen bekleyin...</p>
            </div>
          ) : (
            <>
              <p>Cüzdan adresin: <strong>{address}</strong></p>

              <div className="mt-4">
                <label className="mr-2">Ağ Seç:</label>
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
                  <p className="mt-4">Toplam Fee: <strong>{selectedData.totalFee.toFixed(6)} ETH</strong></p>
                  <p>Ortalama Fee: <strong>{(selectedData.totalFee / selectedData.txCount).toFixed(6)} ETH</strong></p>
                  <p>İşlem Sayısı: <strong>{selectedData.txCount}</strong></p>

                  <h2 className="text-lg font-semibold mt-4">Seçilen Ağ İşlem Ücretleri Grafiği:</h2>
                  <Bar data={chartData} />

                  <h2 className="text-lg font-semibold mt-6">Kategori Bazlı Harcama:</h2>
                  <Pie data={categoryChartData} />

                  <table className="w-full border mt-4">
                    <thead>
                      <tr className="bg-gray-200">
                        <th className="p-2">Kategori</th>
                        <th className="p-2">Toplam Fee (ETH)</th>
                        <th className="p-2">İşlem Sayısı</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(selectedData.categories).map(([cat, val]) => (
                        <tr key={cat} className="border-t">
                          <td className="p-2">{cat}</td>
                          <td className="p-2">{val.totalFee.toFixed(6)}</td>
                          <td className="p-2">{val.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              <h2 className="text-lg font-semibold mt-6">Ağ Bazlı Toplam Fee Karşılaştırması:</h2>
              <Bar data={chainChartData} />

              <table className="w-full border mt-4">
                <thead>
                  <tr className="bg-gray-200">
                    <th className="p-2">Ağ</th>
                    <th className="p-2">Toplam Fee (ETH)</th>
                    <th className="p-2">İşlem Sayısı</th>
                  </tr>
                </thead>
                <tbody>
                  {chainStats.map((stat) => (
                    <tr key={stat.name} className="border-t">
                      <td className="p-2">{stat.name}</td>
                      <td className="p-2">{stat.totalFee.toFixed(6)}</td>
                      <td className="p-2">{stat.txCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </main>
  );
}

export default function Home() {
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={config}>
        <RainbowKitProvider>
          <Dashboard />
        </RainbowKitProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}