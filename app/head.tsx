export default function Head() {
  return (
    <>
      <title>WalletFee - Multi-chain Fee Tracker</title>
      <meta
        name="description"
        content="Track total transaction fee spending across your wallets across multiple blockchains."
      />
      <meta property="og:title" content="WalletFee - Track Gas Spending" />
      <meta
        property="og:description"
        content="Track total transaction fee spending across your wallets across multiple blockchains."
      />
      <meta property="og:image" content="https://mini-fatura.vercel.app/image.png" />

      {/* ✅ Farcaster Frame Metadata */}
      <meta name="fc:frame" content="vNext" />
      <meta name="fc:frame:image" content="https://mini-fatura.vercel.app/splash.png" />
      <meta name="fc:frame:post_url" content="https://mini-fatura.vercel.app/api/webhook" />
      <meta name="fc:frame:button:1" content="Start Tracking Fees" />
      <meta name="fc:frame:button:1:action" content="post" />
    </>
  );
}
