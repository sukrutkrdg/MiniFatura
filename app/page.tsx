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
      console.log('✅ frameHost.ready() success.');
    } else if (host?.actions?.ready) {
      await host.actions.ready();
      console.log('✅ frameHost.actions.ready() success.');
    } else {
      console.log('🌐 Web environment.');
    }
  } catch (e) {
    console.error('❌ Frame init error:', e);
  }
}

interface ChainStat {
  name: string;
  totalFeeUSD: number;
  txCount: number;
  categories: Record<string, { totalFeeUSD: number; count: number }>;
}

function Dashboard() {
  const { address, isConnected } = useAccount();
  const [chainStats, setChainStats] = useState<ChainStat[]>([]);
  const [selectedChain, setSelectedChain] = useState('Ethereum');
  const [loading, setLoading] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const chains = [
    { name: 'Ethereum', slug: 'eth-mainnet' },
    { name: 'Polygon', slug: 'matic-mainnet' },
    { name: 'Optimism', slug: 'optimism-mainnet' },
    { name: 'Arbitrum', slug: 'arbitrum-mainnet' },
    { name: 'Base', slug: 'base-mainnet' },
  ];

  useEffect(() => {
    initFrame();
  }, []);

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

  async function fetchAllTransactions(address: string, chainSlug: string) {
    let page = 0;
    const pageSize = 1000;
    let allItems: any[] = [];
    let hasMore = true;

    while (hasMore) {
      const res = await fetch(
        `https://api.covalenthq.com/v1/${chainSlug}/address/${address}/transactions_v2/?page-number=${page}&page-size=${pageSize}&key=${process.env.NEXT_PUBLIC_COVALENT_API_KEY}`
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

  useEffect(() => {
    if (!isConnected || !address) return;

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const { data: cachedData, error: cacheError } = await supabase
          .from('wallet_stats')
          .select('*')
          .eq('wallet_address', address)
          .single();

        if (cacheError && cacheError.code !== 'PGRST116') {
           console.error('Supabase read error:', cacheError);
        }
        
        const oneHourAgo = new Date(new Date().getTime() - 60 * 60 * 1000).toISOString();
        if (cachedData && cachedData.updated_at > oneHourAgo) {
          console.log('Using cache (Supabase).');
          setChainStats(cachedData.chain_stats);
          setLoading(false);
          return;
        }
        
        console.log('Cache is old or missing. Calling Covalent API...');
        
        const results = await Promise.all(
          chains.map(async (chain) => {
            const items = await fetchAllTransactions(address, chain.slug);
            
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

        setChainStats(results);

        const totalFeeUSDAllChains = results.reduce((s, c) => s + c.totalFeeUSD, 0);

        await supabase.from('wallet_stats').upsert({
          wallet_address: address,
          total_fee: totalFeeUSDAllChains,
          chain_stats: results,
          updated_at: new Date().toISOString(),
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
        console.error('Error fetching data:', err);
        if (err instanceof Error) {
            setError(`An error occurred while fetching data: ${err.message}. Please try again later.`);
        } else {
            setError('An unknown error occurred.');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [address, isConnected]);

  const selectedData = chainStats.find((s) => s.name === selectedChain);

  const chainChartData = {
    labels: chainStats.map((c) => c.name),
    datasets: [
      {
        label: 'Total Fee (USD)',
        data: chainStats.map((c) => c.totalFeeUSD),
        backgroundColor: 'rgba(147,51,234,0.6)',
      },
    ],
  };

  const categoryChartData = {
    labels: selectedData ? Object.keys(selectedData.categories) : [],
    datasets: [
      {
        label: 'Category Spending (USD)',
        data: selectedData
          ? Object.values(selectedData.categories).map((v) => v.totalFeeUSD)
          : [],
        backgroundColor: ['#4F46E5', '#EC4899', '#10B981', '#F59E0B', '#F97316', '#6B7280'],
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

      {isMobile() ? (
          <>
          <button
            onClick={() => setShowWalletModal(true)}
            className="bg-indigo-600 text-white px-6 py-3 rounded-xl shadow-md hover:bg-indigo-700 transition"
          >
            Connect Wallet
          </button>

          {showWalletModal && (
            <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50">
              <div className="bg-white w-full rounded-t-2xl p-6 shadow-lg">
                <h2 className="text-lg font-semibold text-center mb-4">
                  Select Wallet
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
                  Close
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
              <p className="text-sm text-gray-500">(This may take a few minutes the first time depending on wallet activity)</p>
            </div>
          ) : error ? (
            <div className="text-center p-4 bg-red-100 text-red-700 rounded-lg">
                <p><strong>Error!</strong></p>
                <p>{error}</p>
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
                    Total Spend ({selectedData.name}):{' '}
                    <strong>${selectedData.totalFeeUSD.toFixed(2)} USD</strong>
                  </p>
                  <p>
                    Total Transactions: <strong>{selectedData.txCount}</strong>
                  </p>
                  
                  <h2 className="text-lg font-semibold mt-8">{selectedData.name} - Spend by Category</h2>
                  <Pie data={categoryChartData} className="mt-6" />
                </>
              )}

              <h2 className="text-lg font-semibold mt-8">Total Spend by Chain (USD)</h2>
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