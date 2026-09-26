"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";

const schema = z.object({
  email: z.string().min(1, "Email is required.").email("Please enter a valid email address."),
});
type FormValues = z.infer<typeof schema>;

export function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [sent, setSent] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setFormError(null);
    try {
      await requestPasswordReset(values.email);
      // Always shows the same success state whether or not the email is registered - the backend
      // never reveals account existence through this endpoint, and neither should the UI.
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "RATE_LIMITED") setFormError("Too many attempts. Please wait a moment and try again.");
      else if (err instanceof ApiError && (err.code === "NETWORK_ERROR" || err.code === "TIMEOUT")) setFormError("Could not reach the server. Check your connection and try again.");
      else setFormError("Something went wrong. Please try again.");
    }
  }

  if (sent) {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)]">
          <MailCheck className="h-6 w-6 text-[var(--color-success)]" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          If an account exists for <span className="font-medium text-foreground">{getValues("email")}</span>, we&apos;ve sent a password reset link to it.
        </p>
        <Button variant="outline" className="mt-6 w-full" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back to Login
        </Button>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground">
        Enter your email and we&apos;ll send you a link to reset your password.
      </p>
      {formError && (
        <div role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </div>
      )}
      <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="fp-email">Email Address</Label>
          <Input id="fp-email" type="email" autoComplete="email" placeholder="you@company.com" error={!!errors.email} {...register("email")} />
          {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
        </div>
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          Send Reset Link
        </Button>
      </form>
      <Button variant="link" className="mt-2 w-full" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" /> Back to Login
      </Button>
    </div>
  );
}
