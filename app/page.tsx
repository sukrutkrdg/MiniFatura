'use client';

import '@rainbow-me/rainbowkit/styles.css';
import {
  getDefaultConfig,
  RainbowKitProvider,
  ConnectButton,
} from '@rainbow-me/rainbowkit';
import { WagmiProvider, useAccount, useSendTransaction } from 'wagmi';
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
import { frameHost } from '@farcaster/frame-sdk';
import { parseEther } from 'viem'; // GÜNCELLEME: Donate için eklendi

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

function getNativeCurrency(chainName: string): string {
  switch (chainName) {
    case 'Polygon':
      return 'MATIC';
    case 'Ethereum':
    case 'Optimism':
    case 'Arbitrum':
    case 'Base':
      return 'ETH';
    default:
      return 'ETH';
  }
}

// GÜNCELLEME: Donate butonu için yeni bileşen
function DonateButton() {
  const { isConnected } = useAccount();
  const { sendTransaction, isPending } = useSendTransaction();
  const myDonationAddress = '0x973a31858f4d2125f48c880542da11a2796f12d6'; // Senin cüzdan adresin

  const handleDonate = () => {
    sendTransaction({
      to: myDonationAddress,
      value: parseEther('0.005'), // 0.005 ETH (veya chain'in native token'ı)
    });
  };

  if (!isConnected) {
    return (
      <p className="text-center text-sm text-gray-500 mt-8">
        Please connect your wallet to support this tool.
      </p>
    );
  }

  return (
    <button
      onClick={handleDonate}
      disabled={isPending}
      className="mt-8 w-full bg-green-600 text-white px-6 py-3 rounded-xl shadow-md hover:bg-green-700 transition disabled:opacity-50"
    >
      {isPending ? 'Sending...' : 'Support this Tool (Donate 0.005 ETH)'}
    </button>
  );
}


function Dashboard() {
  const { address: connectedAddress, isConnected } = useAccount(); // Bağlı cüzdan
  
  // GÜNCELLEME: İki yeni state
  const [manualAddress, setManualAddress] = useState(''); // Input alanındaki adres
  const [activeAddress, setActiveAddress] = useState<string | null>(null); // Analiz edilen adres

  const [chainStats, setChainStats] = useState<ChainStat[]>([]);
  const [selectedChain, setSelectedChain] = useState('Ethereum');
  const [loading, setLoading] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedChains, setFailedChains] = useState<string[]>([]);
  const [daysFilter, setDaysFilter] = useState('all');

  const chainNames = chainStats.map(c => c.name);

  useEffect(() => {
    initFrame();
  }, []);

  // GÜNCELLEME: Ana veri çekme useEffect'i artık 'activeAddress'e bağlı
  useEffect(() => {
    // Analiz edilecek bir adres yoksa, hiçbir şey yapma
    if (!activeAddress) {
      setChainStats([]);
      setFailedChains([]);
      setError(null);
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      setFailedChains([]);

      try {
        const filterParam = (daysFilter !== 'all') ? `&days=${daysFilter}` : '';
        // 'activeAddress'i kullanarak API'yi çağır
        const res = await fetch(`/api/process-wallet?address=${activeAddress}${filterParam}`);
        
        const data = await res.json();
        
        if (!res.ok) {
          throw new Error(data.error || 'Failed to fetch wallet data from server');
        }

        setChainStats(data.chainStats);
        
        if (data.failedChains && data.failedChains.length > 0) {
            setFailedChains(data.failedChains);
        }
        
        if (data.chainStats.length > 0 && !data.chainStats.find((c: ChainStat) => c.name === selectedChain)) {
            setSelectedChain(data.chainStats[0].name);
        }

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
  }, [activeAddress, daysFilter]); // GÜNCELLEME: Bağımlılık değişti

  const selectedData = chainStats.find((s) => s.name === selectedChain);

  // ... (chartData, categoryChartData, handleWalletClick fonksiyonları aynı kaldı) ...
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

  // GÜNCELLEME: Analizi tetikleyen fonksiyonlar
  const handleManualSubmit = () => {
    if (manualAddress) {
      setActiveAddress(manualAddress);
    }
  };

  const handleConnectedWalletSubmit = () => {
    if (isConnected && connectedAddress) {
      setActiveAddress(connectedAddress);
    }
  };


  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-50">
      
      {/* GÜNCELLEME: ConnectButton'ı sayfanın sağına aldık, sadece "Donate" için */}
      <div className="w-full max-w-3xl flex justify-end mb-4">
        <ConnectButton />
      </div>
      
      <h1 className="text-3xl font-bold mb-6 text-indigo-700">Wallet Fee Tracker</h1>

      {/* GÜNCELLEME: Yeni Analiz Formu */}
      <div className="w-full max-w-xl p-6 bg-white rounded-lg shadow-md mb-8">
        <h2 className="text-xl font-semibold text-center mb-4">Analyze Wallet Fees</h2>
        <div className="flex flex-col sm:flex-row gap-4">
          <input
            type="text"
            value={manualAddress}
            onChange={(e) => setManualAddress(e.target.value)}
            placeholder="Paste any wallet address (0x...) or ENS"
            className="flex-grow p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-black"
          />
          <button
            onClick={handleManualSubmit}
            className="bg-indigo-600 text-white px-6 py-3 rounded-xl shadow-md hover:bg-indigo-700 transition disabled:opacity-50"
            disabled={!manualAddress || loading}
          >
            {loading && activeAddress === manualAddress ? 'Analyzing...' : 'Analyze'}
          </button>
        </div>
        
        <div className="text-center my-4 text-gray-500">OR</div>

        {isMobile() ? (
          // Mobil için özel cüzdan bağlama butonu (sadece analiz için)
          <button
            onClick={() => setShowWalletModal(true)}
            className="w-full bg-gray-200 text-black px-6 py-3 rounded-xl shadow-sm hover:bg-gray-300 transition"
          >
            Connect Wallet to Analyze
          </button>
        ) : (
          // Desktop için "Bağlı cüzdanımı kullan" butonu
          <button
            onClick={handleConnectedWalletSubmit}
            className="w-full bg-gray-200 text-black px-6 py-3 rounded-xl shadow-sm hover:bg-gray-300 transition disabled:opacity-50"
            disabled={!isConnected || loading}
          >
            {loading && activeAddress === connectedAddress ? 'Analyzing...' : (isConnected ? `Analyze ${connectedAddress.substring(0, 6)}...` : 'Connect Wallet to Analyze')}
          </button>
        )}
      </div>

      {/* GÜNCELLEME: Mobil cüzdan modal'ı (RainbowKit'in kendi butonu yerine) */}
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
                  className="border rounded-xl p-3 text-sm font-medium hover:bg-indigo-50"
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


      {/* GÜNCELLEME: Sonuç alanı artık 'activeAddress'e bağlı */}
      {activeAddress && (
        <div className="mt-6 w-full max-w-3xl">
          {loading ? (
            <div className="flex flex-col items-center">
              <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-indigo-500 mb-4"></div>
              <p>Fetching transaction data for {activeAddress.substring(0, 6)}...</p>
              <p className="text-sm text-gray-500">(This may take a few minutes the first time)</p>
            </div>
          ) : error ? (
            <div className="text-center p-4 bg-red-100 text-red-700 rounded-lg">
                <p><strong>Error!</strong></p>
                <p>{error}</p>
            </div>
          ) : (
            <>
              {failedChains.length > 0 && (
                <div className="text-center p-3 mb-4 bg-yellow-100 text-yellow-800 rounded-lg">
                  <p><strong>Warning:</strong> Data for the following chains could not be loaded: {failedChains.join(', ')}.</p>
                </div>
              )}

              {chainStats.length > 0 ? (
                <>
                  <div className="flex justify-between items-center mt-4">
                    <div>
                      <label className="mr-2">Select Chain:</label>
                      <select
                        value={selectedChain}
                        onChange={(e) => setSelectedChain(e.target.value)}
                        className="border p-2 rounded text-black"
                      >
                        {chainNames.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mr-2">Date Range:</label>
                      <select
                        value={daysFilter}
                        onChange={(e) => setDaysFilter(e.target.value)}
                        className="border p-2 rounded text-black"
                      >
                        <option value="all">All Time</option>
                        <option value="30">Last 30 Days</option>
                        <option value="7">Last 7 Days</option>
                      </select>
                    </div>
                  </div>

                  {selectedData && (
                    <>
                      <p className="mt-4">
                        Total Spend ({selectedData.name}):{' '}
                        <strong>${selectedData.totalFeeUSD.toFixed(2)} USD</strong>
                      </p>
                      <p className="mt-1 text-sm text-gray-600">
                        (Total Native Spend:{' '}
                        <strong>
                          {selectedData.totalFeeNative.toFixed(6)}{' '}
                          {getNativeCurrency(selectedData.name)}
                        </strong>
                        )
                      </p>
                      <p className="mt-1">
                        Total Transactions: <strong>{selectedData.txCount}</strong>
                      </p>
                      
                      <h2 className="text-lg font-semibold mt-8">{selectedData.name} - Spend by Category</h2>
                      <Pie data={categoryChartData} className="mt-6" />
                    </>
                  )}

                  <h2 className="text-lg font-semibold mt-8">Total Spend by Chain (USD)</h2>
                  <Bar data={chainChartData} className="mt-2" />

                  {selectedData && selectedData.topTransactions.length > 0 && (
                    <>
                      <h2 className="text-lg font-semibold mt-8">Top 10 Expensive Transactions on {selectedData.name}</h2>
                      <div className="overflow-x-auto mt-2">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-100">
                            <tr>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Fee (Native)</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Fee (USD)</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Hash</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200 text-black">
                            {selectedData.topTransactions.map((tx) => (
                              <tr key={tx.tx_hash}>
                                <td className="px-4 py-2 whitespace-nowrap text-sm">{new Date(tx.date).toLocaleDateString()}</td>
                                <td className="px-4 py-2 whitespace-nowrap text-sm">{tx.category}</td>
                                <td className="px-4 py-2 whitespace-nowrap text-sm">{tx.feeNative.toFixed(6)}</td>
                                <td className="px-4 py-2 whitespace-nowrap text-sm">${tx.feeUSD.toFixed(2)}</td>
                                <td className="px-4 py-2 whitespace-nowrap text-sm">
                                  <a
                                    href={
                                      selectedData.name === 'Polygon' 
                                        ? `https://polygonscan.com/tx/${tx.tx_hash}`
                                        : selectedData.name === 'Arbitrum'
                                        ? `https://arbiscan.io/tx/${tx.tx_hash}`
                                        : selectedData.name === 'Optimism'
                                        ? `https://optimistic.etherscan.io/tx/${tx.tx_hash}`
                                        : selectedData.name === 'Base'
                                        ? `https://basescan.org/tx/${tx.tx_hash}`
                                        : `https://etherscan.io/tx/${tx.tx_hash}`
                                    }
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-indigo-600 hover:text-indigo-900"
                                  >
                                    {tx.tx_hash.substring(0, 10)}...
                                  </a>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  
                  {/* GÜNCELLEME: Donate butonu eklendi */}
                  <DonateButton />
                  
                </>
              ) : (
                 <div className="text-center p-4 text-gray-600">
                    No transactions found for this period.
                 </div>
              )}
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