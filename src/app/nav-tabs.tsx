"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** A row of section links; the one for the current screen carries the red thread. */
export function NavTabs({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  // The longest matching address wins, so "/dashboard/x" is not also current on "/dashboard/x/page-settings".
  const current = items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav className="mx-auto flex w-full gap-1 overflow-x-auto px-2 text-sm font-semibold">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.href === current ? "page" : undefined}
          className={`whitespace-nowrap border-b-[3px] px-2 pb-2.5 pt-2 ${
            item.href === current
              ? "border-thread-red text-ink"
              : "border-transparent text-muted hover:text-ink"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
