"use client";

import { type ReactNode, useState } from "react";
import { Menu, Sparkles } from "lucide-react";
import { AccountMenu } from "@/components/admin/account-menu";
import { SideNav } from "@/components/admin/side-nav";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export function AdminShell({ email, children }: { email: string; children: ReactNode }): React.JSX.Element {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-dvh bg-zinc-50">
      <aside className="hidden w-60 flex-none flex-col border-r bg-white shadow-sm md:flex">
        <div className="flex h-14 flex-none items-center gap-3 border-b px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">CookWithAlchemy</p>
            <p className="text-xs text-muted-foreground">Admin Console</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          <SideNav />
        </div>

        <div className="border-t px-2 py-3">
          <AccountMenu email={email} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-white/95 px-3 backdrop-blur md:hidden">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open navigation menu">
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex w-[86vw] max-w-xs flex-col gap-0 p-0">
              <SheetHeader className="border-b px-4 py-3">
                <SheetTitle className="text-left text-sm font-semibold">CookWithAlchemy Admin</SheetTitle>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-2 py-3">
                <SideNav onNavigate={() => setMobileNavOpen(false)} />
              </div>
              <div className="border-t px-2 py-3">
                <AccountMenu email={email} />
              </div>
            </SheetContent>
          </Sheet>

          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-primary">
              <Sparkles className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">CookWithAlchemy</p>
              <p className="text-[11px] text-muted-foreground">Admin Console</p>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="w-full px-4 py-4 sm:px-6 sm:py-6 md:px-8 md:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
