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

const config = getDefaultConfig({
  appName: 'Web3 Fatura Defteri',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
  chains: [mainnet, polygon, optimism, arbitrum],
});

const queryClient = new QueryClient();

function Dashboard() {
  const { address, isConnected } = useAccount();
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    if (!isConnected || !address) return;

    const fetchTransactions = async () => {
      try {
        const res = await fetch(
          `https://api.covalenthq.com/v1/eth-mainnet/address/${address}/transactions_v2/?key=${process.env.NEXT_PUBLIC_COVALENT_API_KEY}`
        );
        const data = await res.json();
        console.log('Covalent verisi:', data);
        setTransactions(data.data.items);
      } catch (error) {
        console.error('API hatası:', error);
      }
    };

    fetchTransactions();
  }, [address, isConnected]);

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-50">
      <h1 className="text-3xl font-bold mb-6 text-center text-gray-800">
        Web3 Fatura Defteri
      </h1>
      <p className="text-gray-600 mb-4 text-center">
        Zincir üstü harcamalarını takip etmek için cüzdanını bağla.
      </p>
      <ConnectButton />
      {isConnected && (
        <div className="mt-6 text-sm text-gray-700">
          <p>Cüzdan adresin: <strong>{address}</strong></p>
          <p>İşlem verisi konsola yazdırıldı ✅</p>
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