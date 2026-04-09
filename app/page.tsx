import { getCurrentUser } from "@/lib/auth";
import { USER_ROLE } from "@/lib/types";
import { redirect } from "next/navigation";

export default async function Home() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (user.role === USER_ROLE.admin) {
    redirect("/dashboard");
  }

  redirect("/panel");
}
