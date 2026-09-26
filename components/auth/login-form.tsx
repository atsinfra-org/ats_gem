"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session-context";

const schema = z.object({
  email: z.string().min(1, "Email is required.").email("Please enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

type FormValues = z.infer<typeof schema>;

export function LoginForm({
  onSuccess,
  onForgotPassword,
}: {
  onSuccess: () => void;
  onForgotPassword: () => void;
}) {
  const [showPassword, setShowPassword] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const { refreshUser } = useSession();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setFormError(null);
    try {
      await login(values);
      await refreshUser();
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "INVALID_CREDENTIALS") setFormError("Incorrect email or password.");
        else if (err.code === "ACCOUNT_LOCKED") setFormError("Too many failed attempts. Try again later.");
        else if (err.code === "ACCOUNT_SUSPENDED") setFormError("This account has been suspended.");
        else if (err.code === "RATE_LIMITED") setFormError("Too many attempts. Please wait a moment and try again.");
        else if (err.code === "NETWORK_ERROR" || err.code === "TIMEOUT") setFormError("Could not reach the server. Check your connection and try again.");
        else setFormError(err.message);
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {formError && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="login-email">Email Address</Label>
        <Input
          id="login-email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          error={!!errors.email}
          {...register("email")}
        />
        {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="login-password">Password</Label>
          <button type="button" onClick={onForgotPassword} className="text-xs font-medium text-primary hover:underline">
            Forgot Password?
          </button>
        </div>
        <div className="relative">
          <Input
            id="login-password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="••••••••"
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

      <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
        Login
      </Button>
    </form>
  );
}
