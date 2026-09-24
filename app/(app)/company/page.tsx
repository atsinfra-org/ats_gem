"use client";

import * as React from "react";
import { toast } from "sonner";
import { FileText, Upload } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { currentCompany } from "@/lib/mock/companies";

const documents = [
  { name: "GST Certificate.pdf", verified: true },
  { name: "PAN Card.pdf", verified: true },
  { name: "Company Registration.pdf", verified: false },
];

export default function CompanyProfilePage() {
  const [saving, setSaving] = React.useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await new Promise((r) => setTimeout(r, 800));
    setSaving(false);
    toast.success("Company profile updated");
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Company Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">Keep your company details up to date for verified bidding.</p>
      </div>

      <form onSubmit={handleSave}>
        <Card>
          <CardHeader>
            <CardTitle>Company Information</CardTitle>
            <CardDescription>This information appears on your bids and proposals.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="companyName">Company Name</Label>
                <Input id="companyName" defaultValue={currentCompany.name} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="industry">Industry</Label>
                <Input id="industry" defaultValue={currentCompany.industry} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gstin">GSTIN</Label>
                <Input id="gstin" defaultValue={currentCompany.gstin} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pan">PAN</Label>
                <Input id="pan" defaultValue={currentCompany.pan} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="size">Company Size</Label>
                <Input id="size" defaultValue={currentCompany.size} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="website">Website</Label>
                <Input id="website" defaultValue={currentCompany.website} />
              </div>
            </div>

            <Separator />

            <h3 className="text-sm font-semibold text-foreground">Address</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="address">Address</Label>
                <Input id="address" defaultValue={currentCompany.address} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="city">City</Label>
                <Input id="city" defaultValue={currentCompany.city} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="state">State</Label>
                <Input id="state" defaultValue={currentCompany.state} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="contactPerson">Contact Person</Label>
                <Input id="contactPerson" defaultValue={currentCompany.contactPerson} />
              </div>
            </div>

            <Separator />

            <h3 className="text-sm font-semibold text-foreground">Business Categories</h3>
            <div className="flex flex-wrap gap-2">
              {currentCompany.categories.map((c) => (
                <Badge key={c} variant="secondary">{c}</Badge>
              ))}
            </div>

            <Separator />

            <h3 className="text-sm font-semibold text-foreground">Documents</h3>
            <div className="space-y-2.5">
              {documents.map((doc) => (
                <div key={doc.name} className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <span className="flex-1 text-sm text-foreground">{doc.name}</span>
                  <Badge variant={doc.verified ? "success" : "warning"}>{doc.verified ? "Verified" : "Pending"}</Badge>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm">
                <Upload className="h-3.5 w-3.5" /> Upload Document
              </Button>
            </div>
          </CardContent>
          <CardFooter className="justify-end gap-2 border-t border-border pt-5">
            <Button type="button" variant="outline">Cancel</Button>
            <Button type="submit" loading={saving}>Save Changes</Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
