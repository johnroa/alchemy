import { Separator } from "@/components/ui/separator";

export function PageHeader({ title, description }: { title: string; description: string }): React.JSX.Element {
  return (
    <header className="space-y-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Separator />
    </header>
  );
}
