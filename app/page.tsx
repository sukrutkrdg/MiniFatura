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
import { frameHost } from '@farcaster/frame-sdk';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement);

// ✅ RainbowKit Config
const config = getDefaultConfig({
  appName: 'WalletFee Tracker',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
  chains: [mainnet, polygon, optimism, arbitrum],
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

function isMobile() {
  return /Mobi|Android/i.test(navigator.userAgent);
}

async function initFrame() {
  try {
    if (frameHost && typeof (frameHost as any).ready === 'function') {
      await (frameHost as any).ready();
      console.log('✅ frameHost.ready() başarılı.');
    } else if (frameHost?.actions?.ready) {
      await frameHost.actions.ready();
      console.log('✅ frameHost.actions.ready() başarılı.');
    } else {
      console.log('🌐 Web ortamı.');
    }
  } catch (e) {
    console.error('❌ Frame init hatası:', e);
  }
}

interface ChainStat {
  name: string;
  totalFee: number;
  txCount: number;
  fees: number[];
  categories: Record<string, { totalFee: number; count: number }>;
}

function Dashboard() {
  const { address, isConnected } = useAccount();
  const [chainStats, setChainStats] = useState<ChainStat[]>([]);
  const [selectedChain, setSelectedChain] = useState('Ethereum');
  const [loading, setLoading] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);

  useEffect(() => {
    initFrame();
  }, []);

  const chains = [
    { name: 'Ethereum', slug: 'eth-mainnet' },
    { name: 'Polygon', slug: 'polygon-mainnet' },
    { name: 'Optimism', slug: 'optimism-mainnet' },
    { name: 'Arbitrum', slug: 'arbitrum-mainnet' },
  ];

  function classifyTransaction(tx: any): string {
    if (tx.decoded?.name?.toLowerCase().includes('swap')) return 'Swap';
    if (
      tx.log_events?.some(
        (log: any) =>
          log.decoded?.name?.includes('Transfer') &&
          log.sender_contract_decimals === 0
      )
    )
      return 'NFT Trade';
    return 'Transfer';
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
      try {
        const results = await Promise.all(
          chains.map(async (chain) => {
            const items = await fetchAllTransactions(address, chain.slug);
            const categories: Record<string, { totalFee: number; count: number }> = {};
            const fees = items.map((tx: any) => {
              const feeEth = (tx.gas_price * tx.gas_spent) / 1e18;
              const category = classifyTransaction(tx);
              if (!categories[category])
                categories[category] = { totalFee: 0, count: 0 };
              categories[category].totalFee += feeEth;
              categories[category].count += 1;
              return feeEth;
            });
            const totalFee = fees.reduce((s, f) => s + f, 0);
            return { name: chain.name, totalFee, txCount: items.length, fees, categories };
          })
        );

        setChainStats(results);

        await supabase.from('wallet_stats').upsert({
          wallet_address: address,
          total_fee: results.reduce((s, c) => s + c.totalFee, 0),
          chain_stats: results,
          updated_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error('Veri çekme hatası:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [address, isConnected]);

  const selectedData = chainStats.find((s) => s.name === selectedChain);

  const chartData = {
    labels: selectedData ? selectedData.fees.map((_, i) => `Tx ${i + 1}`) : [],
    datasets: [
      {
        label: 'Fee (ETH)',
        data: selectedData ? selectedData.fees : [],
        backgroundColor: 'rgba(99,102,241,0.6)',
      },
    ],
  };

  const chainChartData = {
    labels: chainStats.map((c) => c.name),
    datasets: [
      {
        label: 'Total Fee (ETH)',
        data: chainStats.map((c) => c.totalFee),
        backgroundColor: 'rgba(147,51,234,0.6)',
      },
    ],
  };

  const categoryChartData = {
    labels: selectedData ? Object.keys(selectedData.categories) : [],
    datasets: [
      {
        label: 'Category Spending (ETH)',
        data: selectedData
          ? Object.values(selectedData.categories).map((v) => v.totalFee)
          : [],
        backgroundColor: ['#4F46E5', '#EC4899', '#10B981', '#F59E0B'],
      },
    ],
  };

  // ✅ Wallet modal handle
  const handleWalletClick = (wallet: keyof typeof WALLET_LINKS) => {
    const wcUri = encodeURIComponent(window.location.href);
    const deepLink = `${WALLET_LINKS[wallet]}${wcUri}`;
    window.location.href = deepLink;
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-50">
      <h1 className="text-3xl font-bold mb-6 text-indigo-700">Wallet Fee Tracker</h1>

      {/* Mobilde özel connect modal */}
      {isMobile() ? (
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

      {isConnected && (
        <div className="mt-6 w-full max-w-3xl">
          {loading ? (
            <div className="flex flex-col items-center">
              <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-indigo-500 mb-4"></div>
              <p>Fetching transaction data...</p>
            </div>
          ) : (
            <>
              <div className="mt-4">
                <label className="mr-2">Select Chain:</label>
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
                    Total Fee:{' '}
                    <strong>{selectedData.totalFee.toFixed(6)} ETH</strong>
                  </p>
                  <p>
                    Transactions: <strong>{selectedData.txCount}</strong>
                  </p>
                  <Bar data={chartData} className="mt-4" />
                  <Pie data={categoryChartData} className="mt-6" />
                </>
              )}

              <h2 className="text-lg font-semibold mt-8">
                Total Fee by Chain
              </h2>
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
