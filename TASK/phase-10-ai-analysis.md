# Phase 10 - AI-Assisted Analysis

## Objective

Add optional AI analysis on top of evidence-based rule findings, with redaction and guardrails.

## Deliverables

- AI analysis server action
- prompt builder using finding evidence only
- redaction before prompt
- saved AI analysis in finding
- UI button `Generate AI Analysis`
- tests for prompt data boundaries and redaction

## Scope

AI is optional and secondary.

Rule-based analysis remains source of truth. AI adds:
- clearer explanation
- impact summary
- troubleshooting steps
- possible root causes

## Guardrails

AI must:
- use only provided evidence
- not invent device state or external facts
- say data is insufficient when evidence is weak
- not expose secrets
- not recommend destructive action as first step

## Prompt input

Allowed data:
- finding title/summary/severity
- normalized event fields
- redacted sample raw messages
- asset metadata
- rule metadata
- known event counts/time window

Disallowed data:
- unrelated logs
- credentials/secrets
- full database dumps
- private user data not relevant to event

## Output format

```json
{
  "summary": "...",
  "impact": "...",
  "likelyCauses": ["..."],
  "recommendedActions": ["..."],
  "confidence": "low|medium|high",
  "evidenceLimits": "..."
}
```

## UI

Finding detail:
- Generate AI Analysis button
- Regenerate button admin-only
- show generated time
- show confidence
- keep original rule-based analysis visible

## Cost control

- disabled by default
- admin setting to enable
- max sample events per prompt
- max raw message length per event
- cache result on finding
- do not auto-run except optional Critical-only setting

## Tests

- prompt includes only sample events tied to finding.
- redaction removes secrets.
- missing evidence produces low-confidence instruction.
- result saves to `human_analysis` or separate AI field if added.

## Acceptance criteria

- AI analysis improves readability without replacing evidence.
- No secret values are sent.
- User can trace every AI claim back to event evidence.
