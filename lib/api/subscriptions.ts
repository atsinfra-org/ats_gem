import { pricingPlans, currentSubscription, invoices } from "@/lib/mock/subscriptions";

const delay = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getPlans() {
  await delay();
  return pricingPlans;
}

export async function getCurrentSubscription() {
  await delay();
  return currentSubscription;
}

export async function getInvoices() {
  await delay();
  return invoices;
}

export async function changePlan(_planId: string): Promise<{ success: true }> {
  await delay(900);
  return { success: true };
}

export async function cancelSubscription(): Promise<{ success: true }> {
  await delay(900);
  return { success: true };
}
