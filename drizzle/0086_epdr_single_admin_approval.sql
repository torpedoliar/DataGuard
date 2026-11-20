-- Allow a single site administrator to request and approve an action while
-- preserving the decision identity and timestamp required for local decisions.
ALTER TABLE epdr_actions
  DROP CONSTRAINT IF EXISTS epdr_actions_no_self_approval_check;
--> statement-breakpoint
-- 0082 used an unnamed CHECK, so discover it by definition, not its generated name.
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'epdr_local_approvals'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ~ 'decided_by[[:space:]]*<>[[:space:]]*requested_by'
  LOOP
    EXECUTE format('ALTER TABLE epdr_local_approvals DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE epdr_local_approvals
  ADD CONSTRAINT epdr_local_approvals_decision_check
  CHECK (status = 'pending' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL));
