"use client";

import { ChevronDown, UserCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

export function AccountMenu({ email }: { email: string }): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-auto w-full justify-start gap-2.5 px-2 py-2 hover:bg-zinc-100">
          <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-primary/10">
            <UserCircle2 className="h-4 w-4 text-primary" />
          </div>
          <span className="min-w-0 flex-1 truncate text-left text-xs font-medium">{email}</span>
          <ChevronDown className="h-3 w-3 flex-none text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem>Account</DropdownMenuItem>
        <DropdownMenuItem>Preferences</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
