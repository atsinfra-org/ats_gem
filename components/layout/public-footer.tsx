import Link from "next/link";

const columns = [
  {
    title: "Platform",
    links: [
      { label: "Tender Search", href: "/tenders" },
      { label: "Tender Alerts", href: "/alerts" },
      { label: "Saved Tenders", href: "/saved-tenders" },
      { label: "Bid Tracking", href: "/my-bids" },
    ],
  },
  {
    title: "Solutions",
    links: [
      { label: "MSMEs", href: "/solutions" },
      { label: "Contractors", href: "/solutions" },
      { label: "Enterprises", href: "/solutions" },
      { label: "Consultants", href: "/solutions" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Help Center", href: "/resources" },
      { label: "FAQ", href: "/faq" },
      { label: "Tender Guides", href: "/resources" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Pricing", href: "/pricing" },
      { label: "Contact", href: "/contact" },
    ],
  },
];

export function PublicFooter() {
  return (
    <footer className="border-t border-white/10 bg-[var(--color-navy-deep)] text-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-14">
        <div className="grid grid-cols-2 gap-8 lg:grid-cols-6">
          <div className="col-span-2">
            <span className="text-xl font-bold tracking-tight">
              ATS <span className="text-primary">Gem</span>
            </span>
            <p className="mt-3 max-w-xs text-sm text-white/60">
              Tender intelligence platform helping Indian businesses discover, track and win government &amp; private tenders.
            </p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-semibold text-white">{col.title}</h4>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className="text-sm text-white/60 hover:text-white transition-colors">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-white/50">© 2026 ATS Gem. All rights reserved.</p>
          <div className="flex gap-5 text-xs text-white/50">
            <Link href="#" className="hover:text-white">Privacy</Link>
            <Link href="#" className="hover:text-white">Terms</Link>
            <Link href="#" className="hover:text-white">Cookie Policy</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
