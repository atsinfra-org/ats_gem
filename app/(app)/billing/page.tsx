"use client";

import * as React from "react";
import { toast } from "sonner";
import { CreditCard, Download } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import { currentSubscription, invoices } from "@/lib/mock/subscriptions";
import { format } from "date-fns";

const statusVariant = { paid: "success", pending: "warning", failed: "danger" } as const;

export default function BillingPage() {
  const [cancelOpen, setCancelOpen] = React.useState(false);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">View your billing details and download invoices.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Current Subscription</CardTitle>
            <CardDescription>{currentSubscription.plan} Plan · Billed {currentSubscription.billingCycle}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Next billing date</span><span className="font-medium text-foreground">{format(new Date(currentSubscription.nextBillingDate), "dd MMM yyyy")}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="font-medium text-foreground">₹{currentSubscription.amount.toLocaleString("en-IN")}</span></div>
            <Button variant="outline" size="sm" className="mt-3 w-full text-destructive hover:text-destructive" onClick={() => setCancelOpen(true)}>
              Cancel Subscription
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment Method</CardTitle>
            <CardDescription>Manage how you pay for your subscription.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 rounded-lg border border-border p-3">
              <CreditCard className="h-6 w-6 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">{currentSubscription.paymentMethod}</p>
                <p className="text-xs text-muted-foreground">Expires 08/2028</p>
              </div>
              <Button variant="outline" size="sm">Update</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invoice History</CardTitle>
          <CardDescription>Download past invoices for your records.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Invoice</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Plan</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3 font-mono text-xs text-foreground">{inv.id}</td>
                    <td className="px-5 py-3 text-muted-foreground">{format(new Date(inv.date), "dd MMM yyyy")}</td>
                    <td className="px-5 py-3 text-muted-foreground">{inv.plan}</td>
                    <td className="px-5 py-3 text-foreground">₹{inv.amount.toLocaleString("en-IN")}</td>
                    <td className="px-5 py-3">
                      <Badge variant={statusVariant[inv.status]} className="capitalize">{inv.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => toast.success("Invoice download started")}>
                        <Download className="h-3.5 w-3.5" /> PDF
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <ConfirmModal
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel Subscription?"
        description="You will lose access to Professional plan features at the end of your current billing cycle."
        confirmLabel="Cancel Subscription"
        onConfirm={() => { toast.success("Subscription will be cancelled at the end of the billing cycle"); }}
      />
    </div>
  );
}
