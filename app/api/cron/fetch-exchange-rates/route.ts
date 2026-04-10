/**
 * Daily Vercel Cron job that fetches the official USD/PEN exchange rate
 * from BCRP and stores it in exchange_rates.
 *
 * Schedule: see vercel.json — `0 14 * * *` (14:00 UTC = 09:00 Lima time).
 * The route runs every day; weekends are skipped internally.
 *
 * Auth: protected by CRON_SECRET. Vercel Cron sends the header
 *   Authorization: Bearer <CRON_SECRET>
 * automatically when CRON_SECRET is set as a project env var.
 */

import { fetchAndStorePublicationRate, todayInLima } from "@/lib/bcrp";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  const today = todayInLima();

  try {
    const result = await fetchAndStorePublicationRate(today);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json(
      {
        ok: false,
        publication_date: today.toISOString().split("T")[0],
        error: message,
      },
      { status: 500 },
    );
  }
}
