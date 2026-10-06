import type { TenderDetail } from "@/lib/api/types";
import { formatMoney } from "@/lib/utils";
import { format } from "date-fns";

export function TenderInformation({ tender }: { tender: TenderDetail }) {
  const location = [tender.city, tender.state].filter(Boolean).join(", ") || "Not available";
  const rows: [string, string][] = [
    ["Reference Number", tender.referenceNumber ?? "Not available"],
    ["Procuring Entity", tender.procuringEntity?.name ?? tender.department ?? "Not available"],
    ["Tender Type", tender.tenderType?.name ?? "Not available"],
    ["Category", tender.category?.name ?? "Not available"],
    ["Location", location],
    ["Estimated Value", formatMoney(tender.estimatedValue)],
    ["EMD Amount", formatMoney(tender.emdAmount)],
    ["Tender Fee", formatMoney(tender.tenderFee)],
    ["Published Date", format(new Date(tender.publishedAt), "dd MMM yyyy")],
    ["Last Date for Submission", tender.closingAt ? format(new Date(tender.closingAt), "dd MMM yyyy, hh:mm a") : "Not available"],
    ["Bid Opening Date", tender.openingAt ? format(new Date(tender.openingAt), "dd MMM yyyy, hh:mm a") : "Not available"],
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([label, value], i) => (
            <tr key={label} className={i % 2 === 0 ? "bg-card" : "bg-secondary/40"}>
              <th scope="row" className="w-1/3 px-4 py-3 text-left font-medium text-muted-foreground align-top">
                {label}
              </th>
              <td className="px-4 py-3 text-foreground">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
