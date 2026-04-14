import { Upload } from "lucide-react";
import { getInboxSubmissions, getInboxBatches } from "@/app/actions/inbox";
import { getBankAccounts } from "@/app/actions/bank-accounts";
import { getProjects } from "@/app/actions/projects";
import { getCostCategories } from "@/app/actions/project-budgets";
import { TopBar } from "@/components/app-shell/top-bar";
import { Button } from "@/components/ui/button";
import { SUBMISSION_STATUS } from "@/lib/types";
import { InboxFilters } from "./_components/inbox-filters";
import { InboxBatchBanner } from "./_components/inbox-batch-banner";
import { InboxTable } from "./_components/inbox-table";
import { InboxSourceTabs } from "./_components/inbox-source-tabs";
import { ImportCsvDialog } from "./_components/import-csv-dialog";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function pickFirst(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

function statusFromParam(raw: string): number | undefined {
  if (raw === "pendientes" || raw === "") return SUBMISSION_STATUS.pending;
  if (raw === "aprobados") return SUBMISSION_STATUS.approved;
  if (raw === "rechazados") return SUBMISSION_STATUS.rejected;
  if (raw === "todos") return undefined;
  return SUBMISSION_STATUS.pending;
}

export default async function InboxPage({ searchParams }: Props) {
  const params = await searchParams;
  const search = pickFirst(params.search).trim();
  const batchId = pickFirst(params.batch_id).trim() || undefined;
  const statusParam = pickFirst(params.filter).trim();
  const reviewStatus = statusFromParam(statusParam);

  const [
    submissionsResult,
    batchesResult,
    banksResult,
    projectsResult,
    costCategoriesResult,
  ] = await Promise.all([
    getInboxSubmissions({
      review_status: reviewStatus,
      import_batch_id: batchId ?? null,
      search: search || undefined,
    }),
    getInboxBatches(),
    getBankAccounts({ is_active: true }),
    getProjects(),
    getCostCategories(),
  ]);

  const submissions = submissionsResult.success
    ? submissionsResult.data.data
    : [];
  const batches = batchesResult.success ? batchesResult.data : [];
  const activeBatch = batchId
    ? batches.find((b) => b.import_batch_id === batchId) ?? null
    : null;

  const bankAccounts = banksResult.success ? banksResult.data.data : [];
  const projects = projectsResult.success ? projectsResult.data.data : [];
  const costCategories = costCategoriesResult.success
    ? costCategoriesResult.data
    : [];

  return (
    <div>
      <TopBar
        left={
          <span className="text-sm font-medium text-muted-foreground">
            Inbox
          </span>
        }
        right={
          <ImportCsvDialog>
            <Button size="sm" className="gap-1.5">
              <Upload className="h-3.5 w-3.5" />
              Importar CSV
            </Button>
          </ImportCsvDialog>
        }
      />

      <main className="mx-auto max-w-6xl px-8 py-8">
        <InboxFilters
          search={search}
          batchId={batchId ?? ""}
          filter={statusParam || "pendientes"}
          batches={batches}
        />

        <div className="mt-6">
          <InboxSourceTabs
            paymentCount={
              submissionsResult.success ? submissionsResult.data.total : 0
            }
          />
        </div>

        {activeBatch ? (
          <div className="mt-5">
            <InboxBatchBanner batch={activeBatch} />
          </div>
        ) : null}

        <div className="mt-5">
          <InboxTable
            submissions={submissions}
            bankAccounts={bankAccounts}
            projects={projects}
            costCategories={costCategories}
          />
        </div>

        {submissions.length > 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">
            Mostrando {submissions.length}
            {submissionsResult.success
              ? ` de ${submissionsResult.data.total}`
              : ""}{" "}
            registros.
          </p>
        ) : null}
      </main>
    </div>
  );
}
