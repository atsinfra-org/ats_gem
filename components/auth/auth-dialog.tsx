"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { GoogleIcon } from "@/components/auth/google-icon";
import { AuthIllustration } from "@/components/auth/auth-illustration";
import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { loginWithGoogle } from "@/lib/api/auth";
import { useAuthDialog } from "@/lib/store/auth-dialog-store";
import { cn } from "@/lib/utils";

const highlights = [
  "Keyword & Category Search",
  "Real-time Tender Alerts on Email & WhatsApp",
  "Tender Document Downloads",
];

type Mode = "login" | "register" | "forgot";

export function AuthDialog() {
  const { isOpen, close } = useAuthDialog();
  const router = useRouter();
  const [mode, setMode] = React.useState<Mode>("login");
  const [googleLoading, setGoogleLoading] = React.useState(false);

  function handleClose() {
    close();
    setMode("login");
  }

  function goToDashboard(message: string) {
    toast.success(message);
    handleClose();
    router.push("/dashboard");
  }

  async function handleGoogleAuth() {
    setGoogleLoading(true);
    await loginWithGoogle();
    setGoogleLoading(false);
    goToDashboard("Welcome to ATS Gem!");
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="grid max-w-3xl grid-cols-1 gap-0 overflow-hidden p-0 md:grid-cols-2">
        <VisuallyHidden>
          <DialogTitle>Sign in to ATS Gem</DialogTitle>
        </VisuallyHidden>

        <div className="hidden flex-col justify-between bg-[color-mix(in_srgb,var(--color-primary)_6%,var(--color-background))] p-8 md:flex">
          <div>
            <h2 className="text-2xl font-bold leading-snug text-foreground">
              Get Relevant &amp; <span className="text-primary">Latest Tender Alerts</span>
            </h2>
            <ul className="mt-6 space-y-3">
              {highlights.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-foreground">
                  <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[var(--color-success)]" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <AuthIllustration />
        </div>

        <div className="max-h-[85vh] overflow-y-auto p-6 sm:p-8">
          {mode !== "forgot" && (
            <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1">
              <button
                type="button"
                onClick={() => setMode("login")}
                className={cn(
                  "rounded-md py-1.5 text-sm font-medium transition-colors",
                  mode === "login" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => setMode("register")}
                className={cn(
                  "rounded-md py-1.5 text-sm font-medium transition-colors",
                  mode === "register" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Sign Up
              </button>
            </div>
          )}

          {mode === "forgot" ? (
            <ForgotPasswordForm onBack={() => setMode("login")} />
          ) : (
            <>
              <h1 className="text-xl font-bold text-foreground">
                {mode === "login" ? "Welcome Back" : "Create Your Account"}
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {mode === "login"
                  ? "Login to track saved searches and discover new tenders."
                  : "Sign up to get real-time alerts on tenders that matter to you."}
              </p>

              <Button
                type="button"
                variant="outline"
                size="lg"
                className="mt-6 w-full justify-center gap-3"
                onClick={handleGoogleAuth}
                loading={googleLoading}
              >
                {!googleLoading && <GoogleIcon className="h-5 w-5" />}
                Continue with Google
              </Button>

              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">or continue with email</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              {mode === "login" ? (
                <LoginForm
                  onSuccess={() => goToDashboard("Welcome back!")}
                  onForgotPassword={() => setMode("forgot")}
                />
              ) : (
                <RegisterForm onSuccess={() => goToDashboard("Account created!")} />
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
