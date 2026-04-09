-- Migration: submissions
-- Staging layer for the scan-and-upload workflow.
-- Nothing here affects balances or financial reports until approved.

CREATE TABLE submissions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type           smallint NOT NULL,                   -- 1=incoming_invoice, 2=outgoing_invoice, 3=payment
  submitted_by          uuid NOT NULL REFERENCES users(id),
  submitted_at          timestamptz NOT NULL DEFAULT now(),
  image_url             text,
  pdf_url               text,
  xml_url               text,
  -- Pre-filled fields from OCR/AI parsing. Admin reviews and corrects before approving.
  extracted_data        jsonb NOT NULL DEFAULT '{}',
  review_status         smallint NOT NULL DEFAULT 1,         -- 1=pending, 2=approved, 3=rejected
  reviewed_by           uuid REFERENCES users(id),
  reviewed_at           timestamptz,
  rejection_notes       text,
  -- Set on approval — bidirectional link to the created record
  resulting_record_id   uuid,
  resulting_record_type text,                                -- e.g. 'incoming_invoices'
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,

  CONSTRAINT approved_has_result
    CHECK (review_status != 2 OR
      (resulting_record_id IS NOT NULL AND resulting_record_type IS NOT NULL)),

  CONSTRAINT rejected_no_result
    CHECK (review_status != 3 OR resulting_record_id IS NULL)
);

-- Add submission_id FKs to tables that reference submissions
ALTER TABLE outgoing_invoices
  ADD CONSTRAINT outgoing_invoices_submission_id_fkey
  FOREIGN KEY (submission_id) REFERENCES submissions(id);

ALTER TABLE incoming_invoices
  ADD CONSTRAINT incoming_invoices_submission_id_fkey
  FOREIGN KEY (submission_id) REFERENCES submissions(id);

ALTER TABLE payments
  ADD CONSTRAINT payments_submission_id_fkey
  FOREIGN KEY (submission_id) REFERENCES submissions(id);
