export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#1d4a39" />
      <circle cx="12" cy="13" r="4.6" fill="none" stroke="#f6f3ec" strokeWidth="2" />
      <path d="M16.2 15.4 25 22M20.4 18.9l-1.7 2.6M23.2 21.1l-1.6 2.4" stroke="#e9c98c" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark />
      <span className="font-display text-2xl leading-none tracking-tight text-ink">Heirloom</span>
    </span>
  );
}
