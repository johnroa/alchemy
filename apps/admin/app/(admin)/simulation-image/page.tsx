import { redirect } from "next/navigation";

export default function LegacyImageSimulationsPage(): never {
  redirect("/images?tab=quality");
}
