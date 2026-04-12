"use client";

import { useState } from "react";
import { ProjectInlineField } from "./project-inline-field";
import type { ProjectRow } from "@/lib/types";
import { formatDate } from "@/lib/format";

type Props = {
  project: ProjectRow;
};

export function MetadataFields({ project }: Props) {
  // Local drafts held here so the confirm callback can read them
  const [location, setLocation] = useState(project.location ?? "");
  const [contractValue, setContractValue] = useState(
    project.contract_value != null ? String(project.contract_value) : "",
  );
  const [currency, setCurrency] = useState<"PEN" | "USD">(
    (project.contract_currency as "PEN" | "USD") ?? "PEN",
  );
  const [startDate, setStartDate] = useState(project.start_date ?? "");
  const [endDate, setEndDate] = useState(project.expected_end_date ?? "");

  const contractDisplay = project.contract_value
    ? `${project.contract_currency === "USD" ? "$" : "S/"} ${Number(project.contract_value).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";

  const periodoDisplay =
    project.start_date && project.expected_end_date
      ? `${formatDate(project.start_date)} → ${formatDate(project.expected_end_date)}`
      : project.start_date
        ? `Desde ${formatDate(project.start_date)}`
        : "—";

  return (
    <>
      <ProjectInlineField
        label="Ubicación"
        display={
          project.location || (
            <span className="text-muted-foreground/40">—</span>
          )
        }
        projectId={project.id}
        borderRight
        renderEdit={({ saving }) => (
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            disabled={saving}
            placeholder="Ubicación"
            className="w-full rounded-md px-2 py-1 text-sm focus:outline-none border border-primary"
            style={{ boxShadow: "0 0 0 2px rgba(196,120,92,0.1)" }}
          />
        )}
        buildPayload={() => ({ location: location.trim() || null })}
      />
      <ProjectInlineField
        label="Contrato"
        display={<span className="tabular-nums font-medium">{contractDisplay}</span>}
        projectId={project.id}
        borderRight
        renderEdit={({ saving }) => (
          <div className="flex gap-1.5">
            <input
              type="text"
              value={contractValue}
              onChange={(e) =>
                setContractValue(e.target.value.replace(/[^0-9.]/g, ""))
              }
              disabled={saving}
              inputMode="decimal"
              placeholder="0.00"
              className="flex-1 rounded-md px-2 py-1 font-mono text-sm text-right focus:outline-none border border-primary"
              style={{ boxShadow: "0 0 0 2px rgba(196,120,92,0.1)" }}
            />
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as "PEN" | "USD")}
              disabled={saving}
              className="rounded-md px-2 py-1 text-sm focus:outline-none border border-primary"
              style={{ boxShadow: "0 0 0 2px rgba(196,120,92,0.1)" }}
            >
              <option value="PEN">PEN</option>
              <option value="USD">USD</option>
            </select>
          </div>
        )}
        buildPayload={() => {
          const parsed = contractValue
            ? parseFloat(contractValue.replace(/,/g, ""))
            : null;
          return {
            contract_value: parsed,
            contract_currency: currency,
          };
        }}
      />
      <ProjectInlineField
        label="Periodo"
        display={periodoDisplay}
        projectId={project.id}
        renderEdit={({ saving }) => (
          <div className="flex gap-1.5">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={saving}
              className="flex-1 rounded-md px-2 py-1 text-xs focus:outline-none border border-primary"
              style={{ boxShadow: "0 0 0 2px rgba(196,120,92,0.1)" }}
            />
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={saving}
              className="flex-1 rounded-md px-2 py-1 text-xs focus:outline-none border border-primary"
              style={{ boxShadow: "0 0 0 2px rgba(196,120,92,0.1)" }}
            />
          </div>
        )}
        buildPayload={() => ({
          start_date: startDate || null,
          expected_end_date: endDate || null,
        })}
      />
    </>
  );
}
