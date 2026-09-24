"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserCircle, Building2, CreditCard, LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { currentUser } from "@/lib/mock/users";

export function UserMenu() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-secondary" aria-label="Account menu">
        <Avatar className="h-8 w-8">
          <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
            {currentUser.avatarInitials}
          </AvatarFallback>
        </Avatar>
        <div className="hidden text-left lg:block">
          <p className="text-sm font-medium leading-tight text-foreground">{currentUser.name}</p>
          <p className="text-xs leading-tight text-muted-foreground">{currentUser.company}</p>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>My Account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile"><UserCircle className="h-4 w-4" /> My Profile</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/company"><Building2 className="h-4 w-4" /> Company Profile</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/subscription"><CreditCard className="h-4 w-4" /> Subscription</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {theme === "dark" ? "Light Mode" : "Dark Mode"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onClick={() => router.push("/login")}>
          <LogOut className="h-4 w-4" /> Log Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
