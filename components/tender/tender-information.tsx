import type { Tender } from "@/lib/types";
import { formatINR } from "@/lib/utils";
import { format } from "date-fns";

export function TenderInformation({ tender }: { tender: Tender }) {
  const rows: [string, string][] = [
    ["Tender ID", tender.tenderId],
    ["Department", tender.department],
    ["Tender Type", tender.tenderType],
    ["Category", tender.category],
    ["Location", `${tender.location}, ${tender.state}`],
    ["Estimated Value", formatINR(tender.estimatedValue)],
    ["EMD Amount", formatINR(tender.emdAmount)],
    ["Document Fee", formatINR(tender.documentFee)],
    ["Published Date", format(new Date(tender.publishedDate), "dd MMM yyyy")],
    ["Last Date for Submission", format(new Date(tender.submissionDeadline), "dd MMM yyyy, hh:mm a")],
    ["Bid Opening Date", format(new Date(tender.bidOpeningDate), "dd MMM yyyy, hh:mm a")],
    ["Source", tender.source],
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
