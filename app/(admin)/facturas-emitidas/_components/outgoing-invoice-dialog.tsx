"use client";

import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogTitle,
} from "@/components/ui/dialog";
import { OutgoingInvoiceForm } from "./outgoing-invoice-form";

export function OutgoingInvoiceDialog({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="sm:max-w-5xl max-h-[calc(100vh-3rem)] p-0 gap-0 flex flex-col"
        showCloseButton
      >
        <DialogTitle className="sr-only">Nueva factura emitida</DialogTitle>
        <div className="flex-1 overflow-y-auto px-6 pt-5 pb-5">
          <OutgoingInvoiceForm
            variant="dialog"
            onAfterSave={() => setOpen(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
