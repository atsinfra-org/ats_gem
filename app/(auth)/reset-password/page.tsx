"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPassword } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";

const schema = z
  .object({
    password: z.string().min(8, "Password must contain at least 8 characters."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

type FormValues = z.infer<typeof schema>;

function ResetPasswordPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [showPassword, setShowPassword] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    if (!token) return;
    setFormError(null);
    try {
      await resetPassword(token, values.password);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "TOKEN_INVALID_OR_EXPIRED") setFormError("This reset link is invalid or has expired. Request a new one.");
      else if (err instanceof ApiError && err.code === "VALIDATION_FAILED") setFormError(err.details?.[0]?.message ?? "Please check the form for errors.");
      else setFormError("Something went wrong. Please try again.");
    }
  }

  if (!token) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
        <XCircle className="h-12 w-12 text-destructive" />
        <h1 className="mt-4 text-xl font-bold text-foreground">Missing reset token</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">This link is not a valid password reset link.</p>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/">Back to Home</Link>
        </Button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
        <CheckCircle2 className="h-12 w-12 text-[var(--color-success)]" />
        <h1 className="mt-4 text-xl font-bold text-foreground">Password reset</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Your password has been updated. You can now log in with your new password.</p>
        <Button className="mt-6" onClick={() => router.push("/")}>
          Back to Home
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-sm flex-col justify-center px-4">
      <h1 className="text-xl font-bold text-foreground">Set a new password</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Choose a new password for your account.</p>

      {formError && (
        <div role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="new-password">New Password</Label>
          <div className="relative">
            <Input
              id="new-password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              error={!!errors.password}
              className="pr-10"
              {...register("password")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">Confirm New Password</Label>
          <Input id="confirm-password" type={showPassword ? "text" : "password"} autoComplete="new-password" error={!!errors.confirmPassword} {...register("confirmPassword")} />
          {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
        </div>
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          Reset Password
        </Button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <React.Suspense fallback={null}>
      <ResetPasswordPageInner />
    </React.Suspense>
  );
}
