type AssetFallbackNoticeProps = {
  message: string;
  onRetry: () => void;
};

export function AssetFallbackNotice({ message, onRetry }: AssetFallbackNoticeProps) {
  return (
    <aside className="asset-fallback-notice" role="status" aria-live="polite">
      <div>
        <p className="eyebrow">Optional assets unavailable</p>
        <p>{message}</p>
      </div>
      <button className="asset-retry-button" type="button" onClick={onRetry}>
        Retry assets
      </button>
    </aside>
  );
}
