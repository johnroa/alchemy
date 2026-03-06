import { redirect } from "next/navigation";

export default function LegacyImagePipelinePage(): never {
  redirect("/images?tab=pipeline");
}
