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

const schema = z.object({
  email: z.string().min(1, "Email is required.").email("Please enter a valid email address."),
});
type FormValues = z.infer<typeof schema>;

export function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [sent, setSent] = React.useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    await requestPasswordReset(values.email);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)]">
          <MailCheck className="h-6 w-6 text-[var(--color-success)]" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          We&apos;ve sent a password reset link to <span className="font-medium text-foreground">{getValues("email")}</span>.
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
      <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="fp-email">Email Address</Label>
          <Input id="fp-email" type="email" placeholder="you@company.com" error={!!errors.email} {...register("email")} />
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
