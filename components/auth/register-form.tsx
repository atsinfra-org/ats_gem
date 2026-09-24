"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { register as registerAccount } from "@/lib/api/auth";

const schema = z
  .object({
    name: z.string().min(1, "Full name is required."),
    email: z.string().min(1, "Email is required.").email("Please enter a valid email address."),
    password: z.string().min(8, "Password must contain at least 8 characters."),
    confirmPassword: z.string(),
    terms: z.boolean().refine((v) => v === true, { message: "You must accept the terms to continue." }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

type FormValues = z.infer<typeof schema>;

export function RegisterForm({ onSuccess }: { onSuccess: () => void }) {
  const [showPassword, setShowPassword] = React.useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    await registerAccount(values);
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="register-name">Full Name</Label>
        <Input id="register-name" placeholder="Your name" error={!!errors.name} {...register("name")} />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="register-email">Email</Label>
        <Input id="register-email" type="email" placeholder="you@company.com" error={!!errors.email} {...register("email")} />
        {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="register-password">Password</Label>
          <div className="relative">
            <Input
              id="register-password"
              type={showPassword ? "text" : "password"}
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
          <Label htmlFor="register-confirm">Confirm Password</Label>
          <Input
            id="register-confirm"
            type={showPassword ? "text" : "password"}
            error={!!errors.confirmPassword}
            {...register("confirmPassword")}
          />
          {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
        </div>
      </div>

      <div className="flex items-start gap-2 pt-1">
        <Checkbox id="register-terms" onCheckedChange={(v) => setValue("terms", v === true)} />
        <Label htmlFor="register-terms" className="text-xs font-normal leading-snug text-muted-foreground">
          I agree to the{" "}
          <Link href="#" className="text-primary hover:underline">Terms of Service</Link> and{" "}
          <Link href="#" className="text-primary hover:underline">Privacy Policy</Link>.
        </Label>
      </div>
      {errors.terms && <p className="text-xs text-destructive">{errors.terms.message}</p>}

      <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
        Create Account
      </Button>
    </form>
  );
}
