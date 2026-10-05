import Link from "next/link";
import { cn } from "@/lib/utils";

/** Compass-star mark used in the header and sign-in page. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8", className)}>
      <circle cx="16" cy="16" r="14.5" fill="none" stroke="currentColor" strokeOpacity=".28" strokeWidth="1.5" />
      <path
        d="M16 4.5 18.4 13.6 27.5 16 18.4 18.4 16 27.5 13.6 18.4 4.5 16 13.6 13.6Z"
        fill="currentColor"
      />
      <circle cx="16" cy="16" r="2" fill="var(--background)" />
    </svg>
  );
}

export function Logo({ href = "/trips", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn("focus-ring inline-flex items-center gap-2 rounded-lg text-ink", className)}
      aria-label="rove home"
    >
      <LogoMark className="text-teal" />
      <span className="font-display text-[1.75rem] leading-none font-semibold">rove</span>
    </Link>
  );
}

export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-5", className)}>
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.87-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.27v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.6 4.59 1.8l3.43-3.43A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.27 6.6l4 3.1C6.22 6.86 8.87 4.75 12 4.75Z" />
    </svg>
  );
}

/** Simplified Drive triangle, used to mark Google Drive links. */
export function DriveIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 21" aria-hidden="true" className={cn("size-5", className)}>
      <path fill="#0F9D58" d="M8 0h8l8 13.9h-8Z" />
      <path fill="#FFC107" d="M8 0 0 13.9l4 6.9 8-13.9Z" />
      <path fill="#4285F4" d="M4 20.8h16l4-6.9H8Z" />
    </svg>
  );
}
