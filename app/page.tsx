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
import { frameHost } from '@farcaster/frame-sdk'; // ✅ Güncel SDK import

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement);

// Wagmi + RainbowKit Config
const config = getDefaultConfig({
  appName: 'Web3 Fatura Defteri',
  projectId: 'YOUR_PROJECT_ID',
  chains: [mainnet, polygon, optimism, arbitrum],
  ssr: true,
});

const queryClient = new QueryClient();

function Dashboard() {
  const { address, isConnected } = useAccount();
  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // ✅ Farcaster Frame Ready sinyali (mobilde mor ekranı kaldırır)
  useEffect(() => {
    const init = async () => {
      try {
        const host = await frameHost();
        await host.ready();
        console.log('✅ Farcaster frameHost ready() çağrısı başarılı.');
      } catch (e) {
        console.error('❌ Farcaster SDK ready çağrısı sırasında hata:', e);
      }
    };
    init();
  }, []);

  // 📦 Supabase'den veri çek
  useEffect(() => {
    const fetchExpenses = async () => {
      if (!isConnected || !address) return;
      setLoading(true);
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .eq('wallet_address', address);
      if (error) console.error(error);
      else setExpenses(data || []);
      setLoading(false);
    };
    fetchExpenses();
  }, [address, isConnected]);

  const totalAmount = expenses.reduce((acc, e) => acc + e.amount, 0);
  const categoryTotals: Record<string, number> = {};
  expenses.forEach((e) => {
    categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount;
  });

  const barData = {
    labels: Object.keys(categoryTotals),
    datasets: [
      {
        label: 'Giderler (₺)',
        data: Object.values(categoryTotals),
        backgroundColor: '#4F46E5',
      },
    ],
  };

  const pieData = {
    labels: Object.keys(categoryTotals),
    datasets: [
      {
        data: Object.values(categoryTotals),
        backgroundColor: [
          '#4F46E5',
          '#EC4899',
          '#10B981',
          '#F59E0B',
          '#3B82F6',
        ],
      },
    ],
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-100 flex flex-col items-center p-4">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-lg p-6 mt-6">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold text-indigo-700">
            Web3 Fatura Defteri
          </h1>
          <ConnectButton />
        </div>

        {!isConnected ? (
          <p className="text-center text-gray-600 mt-8">
            Cüzdanınızı bağlayın.
          </p>
        ) : loading ? (
          <p className="text-center text-gray-600 mt-8">Yükleniyor...</p>
        ) : expenses.length === 0 ? (
          <p className="text-center text-gray-600 mt-8">
            Henüz gider bulunamadı.
          </p>
        ) : (
          <>
            <p className="text-center text-gray-700 mb-4">
              Toplam Gider: <b>{totalAmount.toFixed(2)} ₺</b>
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h2 className="text-lg font-semibold text-indigo-600 mb-2">
                  Kategorilere Göre Dağılım
                </h2>
                <Bar data={barData} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-indigo-600 mb-2">
                  Oransal Gösterim
                </h2>
                <Pie data={pieData} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ✅ Uygulamanın ana provider’ları
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
