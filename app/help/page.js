import { redirect } from "next/navigation";

export default function HelpPage() {
  redirect("/settings?section=account&chat=open");
}
