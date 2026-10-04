import type { ReactNode, SVGProps } from "react";

/** A small set of line icons (24px grid, 1.7 stroke). Decorative by default: they sit next to a text label. */
function Svg({ children, size = 20, ...p }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
      {children}
    </svg>
  );
}

type P = SVGProps<SVGSVGElement> & { size?: number };
const make = (body: ReactNode) => function Icon(p: P) { return <Svg {...p}>{body}</Svg>; };

export const LockIcon = make(<><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>);
export const UnlockIcon = make(<><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></>);
export const KeyIcon = make(<><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3M14 9l2 2" /></>);
export const ShieldIcon = make(<><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>);
export const UsersIcon = make(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><circle cx="17" cy="9" r="2.5" /><path d="M17.5 14c2.6.3 4 2.2 4 5" /></>);
export const PulseIcon = make(<path d="M3 12h4l2.5-6 4 12 2.5-6H21" />);
export const ClockIcon = make(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const FlagIcon = make(<path d="M5 21V4M5 4h11l-2 4 2 4H5" />);
export const SnowflakeIcon = make(<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />);
export const HourglassIcon = make(<path d="M6 3h12M6 21h12M7 3c0 5 3 6 5 9-2 3-5 4-5 9M17 3c0 5-3 6-5 9 2 3 5 4 5 9" />);
export const IdCardIcon = make(<><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M6.5 16c.6-1.5 1.6-2 2.5-2s1.9.5 2.5 2M14 10h4M14 14h3" /></>);
export const BellIcon = make(<><path d="M6 9a6 6 0 1 1 12 0c0 6 2 7.5 2 7.5H4S6 15 6 9Z" /><path d="M10 20a2 2 0 0 0 4 0" /></>);
export const DocIcon = make(<><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>);
export const ListIcon = make(<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />);
export const RefreshIcon = make(<path d="M20 11a8 8 0 0 0-14.5-3M4 5v4h4M4 13a8 8 0 0 0 14.5 3M20 19v-4h-4" />);
export const LifebuoyIcon = make(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" /><path d="M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9" /></>);
export const GlobeIcon = make(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" /></>);
export const CoinsIcon = make(<><circle cx="9" cy="9" r="6" /><path d="M15.2 9.4A6 6 0 1 1 9.4 15.2M7 9h4M9 7v4" /></>);
export const MailIcon = make(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>);
export const ChatIcon = make(<path d="M4 5h16v11H10l-5 4v-4H4z" />);
export const CheckIcon = make(<path d="M5 12l4.5 4.5L19 7" />);
export const ArrowRightIcon = make(<path d="M4 12h16M14 6l6 6-6 6" />);
export const EyeIcon = make(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>);
export const ServerIcon = make(<><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /><path d="M7 7h.01M7 17h.01" /></>);
export const LinkIcon = make(<path d="M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1" />);
export const SplitIcon = make(<><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="12" r="2.5" /><path d="M6 8.5v7M8.5 6C14 6 16 8 16 10M8.5 18c5.5 0 7.5-2 7.5-4" /></>);
export const GiftIcon = make(<><rect x="4" y="9" width="16" height="11" rx="1" /><path d="M3 9h18V6H3zM12 6v14M12 6c-1-3-5-3-5-1s3 1 5 1c2 0 5 1 5-1s-4-2-5 1" /></>);
export const WalletIcon = make(<><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M16 14.5h2" /></>);
export const FileLockIcon = make(<><path d="M6 3h8l4 4v6M6 3v18h6" /><rect x="13" y="15" width="8" height="6" rx="1.2" /><path d="M15 15v-1.5a2 2 0 0 1 4 0V15" /></>);
export const CodeIcon = make(<><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" /></>);
export const LetterIcon = make(<><path d="M5 4h14v16H5z" /><path d="M8 9h8M8 13h8M8 17h4" /></>);
export const UserIcon = make(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" /></>);
export const SettingsIcon = make(<><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>);
export const HomeIcon = make(<path d="M4 11l8-7 8 7v9H4zM10 20v-5h4v5" />);
