"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { AlchemyLogo } from "./alchemy-logo";
import { AccountMenu } from "@/components/admin/account-menu";
import { BUILD_INFO } from "@/lib/build-info.generated";
import {
  ADMIN_SECTIONS,
  getBreadcrumbsForPathname,
  getPageForPathname,
  getSectionForPathname,
  getSectionPages,
  isActivePath,
} from "@/lib/admin-navigation";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export function AdminShell({ email, children }: { email: string; children: ReactNode }): React.JSX.Element {
  const pathname = usePathname();
  const page = getPageForPathname(pathname);
  const section = getSectionForPathname(pathname);
  const breadcrumbs = getBreadcrumbsForPathname(pathname);
  const isSectionRootPage = page.href === section.href;
  const builtAtLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  }).format(new Date(BUILD_INFO.builtAt));

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="border-r border-sidebar-border/80 bg-sidebar">
        <SidebarHeader className="gap-0 border-b border-sidebar-border/80 px-3 py-3">
          <div className="flex items-center gap-3 px-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary shadow-sm">
              <AlchemyLogo className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">CookWithAlchemy</p>
              <p className="text-xs text-sidebar-foreground/70">Admin Control Surface</p>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent className="px-2 py-3">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {ADMIN_SECTIONS.map((item) => {
                  const Icon = item.icon;
                  const active = isActivePath(pathname, item.href);
                  const itemPages = getSectionPages(item.key);
                  const showInlinePages = active && itemPages.length > 1;

                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.title} size="lg">
                        <Link href={item.href}>
                          <Icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>

                      {showInlinePages ? (
                        <SidebarMenuSub>
                          {itemPages.map((pageItem) => {
                            const pageActive = isActivePath(pathname, pageItem.href);
                            return (
                              <SidebarMenuSubItem key={pageItem.key}>
                                <SidebarMenuSubButton asChild isActive={pageActive}>
                                  <Link href={pageItem.href}>
                                    <span>{pageItem.navLabel}</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            );
                          })}
                        </SidebarMenuSub>
                      ) : null}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border/80 px-2 py-3">
          <AccountMenu email={email} />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0 bg-[linear-gradient(180deg,rgba(8,12,20,0.98)_0%,rgba(13,19,31,0.96)_100%)]">
        <header className="sticky top-0 z-20 border-b border-border/60 bg-background/85 backdrop-blur">
          <div className="px-4 py-3 sm:px-6 md:px-8">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-3">
                <div className="flex items-center gap-2">
                  <SidebarTrigger className="shrink-0" />
                  <Breadcrumb>
                    <BreadcrumbList>
                      {breadcrumbs.map((crumb, index) => {
                        const isLast = index === breadcrumbs.length - 1;
                        return (
                          <div key={crumb.href} className="flex items-center gap-2">
                            <BreadcrumbItem>
                              {isLast ? (
                                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                              ) : (
                                <BreadcrumbLink asChild>
                                  <Link href={crumb.href}>{crumb.label}</Link>
                                </BreadcrumbLink>
                              )}
                            </BreadcrumbItem>
                            {!isLast ? (
                              <BreadcrumbSeparator>
                                <ChevronRight className="h-3.5 w-3.5" />
                              </BreadcrumbSeparator>
                            ) : null}
                          </div>
                        );
                      })}
                    </BreadcrumbList>
                  </Breadcrumb>
                </div>

                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-semibold tracking-tight text-foreground">{section.title}</h1>
                    {!isSectionRootPage ? (
                      <Badge variant="outline" className="hidden sm:inline-flex">
                        {page.title}
                      </Badge>
                    ) : null}
                    <Badge variant="outline" className="hidden font-mono text-[11px] text-muted-foreground md:inline-flex">
                      {`build ${BUILD_INFO.commitSha} · ${builtAtLabel} UTC`}
                    </Badge>
                  </div>
                  <p className="max-w-3xl text-sm text-muted-foreground">{section.description}</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1">
          <div className="w-full px-4 py-4 sm:px-6 sm:py-6 md:px-8 md:py-8">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
