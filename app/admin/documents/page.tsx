import { Card } from "@/components/ui/card";
import { FileText, FileSpreadsheet, FileArchive } from "lucide-react";
import { tenders } from "@/lib/mock/tenders";

const iconByType = { pdf: FileText, xlsx: FileSpreadsheet, zip: FileArchive, docx: FileText };

export default function AdminDocumentsPage() {
  const documents = tenders.slice(0, 12).flatMap((t) => t.documents.map((d) => ({ ...d, tenderTitle: t.title, tenderId: t.tenderId })));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Documents</h2>
        <p className="text-sm text-muted-foreground">{documents.length.toLocaleString("en-IN")} documents indexed across tenders</p>
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">Document</th>
              <th className="px-5 py-3 font-medium">Tender</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Size</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => {
              const Icon = iconByType[doc.type];
              return (
                <tr key={doc.id} className="border-b border-border last:border-0 hover:bg-secondary/40">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2 font-medium text-foreground">
                      <Icon className="h-4 w-4 text-muted-foreground" /> {doc.name}
                    </div>
                  </td>
                  <td className="px-5 py-3 max-w-xs truncate text-muted-foreground">{doc.tenderTitle}</td>
                  <td className="px-5 py-3 uppercase text-muted-foreground">{doc.type}</td>
                  <td className="px-5 py-3 text-muted-foreground">{doc.sizeKb >= 1024 ? `${(doc.sizeKb / 1024).toFixed(1)} MB` : `${doc.sizeKb} KB`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
