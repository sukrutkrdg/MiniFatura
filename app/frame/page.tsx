export default function FramePreview() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h1 className="text-3xl font-bold mb-4">Farcaster Frame Preview</h1>
      /api/frame-image?fee=0.547 ETH&category=Swap
      <p className="mt-4">Bu görsel Farcaster Frame’de görünecek.</p>
    </div>
  );
}