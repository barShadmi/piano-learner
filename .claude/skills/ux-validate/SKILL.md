---
name: ux-validate
description: "Trigger whenever reviewing a PR, code change, or feature for shipping readiness and a UX Discovery Document exists at docs/ux-discovery/ — always invoke on phrases like \"review this PR before we ship\", \"is this feature ready to ship\", \"validate this implementation against our discovery doc\", \"check that this code matches what we researched\", \"before we mark this complete sanity check it\", \"does this still serve the primary persona\", \"we're about to ship is anything missing\", \"review the implementation for UX alignment\", \"I'm worried we drifted from the original user goals\", or \"the team wants to ship it but I'm not sure\". This is the throughout companion to ux-discover: it runs DURING and AFTER implementation to catch drift between what was researched and what's being shipped, scoring persona alignment, JTBD coverage, journey gap closure, design-principle adherence, telemetry instrumentation, and assumption validity against the discovery doc. It is COMPLEMENTARY to code review, NOT a replacement — run it alongside superpowers:code-reviewer, linters, and generic code-quality reviewers; both dimensions should gate the same PR. Push to invoke even when the user only asks for a \"quick sanity check\" or \"is this good to merge\" on any user-facing surface with a discovery doc present. Do NOT trigger when no docs/ux-discovery/ document exists (run ux-discover first), for pure technical refactors with no user-facing surface, engineering-internal bug fixes, performance or security reviews, dependency upgrades, doc generation, or while ux-discover is still in progress.\n"
version: '1.0.0'
---

# UX Validation

Check that what you're building still serves the user you researched.

## When to Use

- Before marking a feature complete
- During code review
- When making tradeoff decisions
- When scope changes are proposed
- When the team says "let's just ship it"

## Validation Checklist

Read the project's UX Discovery Document from `docs/ux-discovery/` and evaluate:

### 1. Persona Alignment
- [ ] Does this serve the PRIMARY persona's needs?
- [ ] Does it avoid harming secondary personas?
- [ ] Does it match the persona's technical sophistication level?
- [ ] Does it fit the persona's context of use (device, environment, time pressure)?

### 2. JTBD Coverage
- [ ] Does this help users accomplish the PRIMARY job?
- [ ] Does it address the functional need?
- [ ] Does it support the emotional goal (how they want to feel)?
- [ ] Does it consider the social goal (how they want to be perceived)?

### 3. Journey Gap Closure
- [ ] Does this address identified pain points from the journey map?
- [ ] Does it preserve existing moments of delight?
- [ ] Does it move the experience toward the desired state?
- [ ] Does it handle the error/edge case journey, not just the happy path?

### 4. Design Principle Adherence
- [ ] Does this align with each stated design principle?
- [ ] If it violates a principle, is there an explicit, documented reason?

### 5. Metric Instrumentation
- [ ] Are the specified telemetry events implemented?
- [ ] Can we measure the North Star Metric with what's built?
- [ ] Are guard-rail health metrics in place?
- [ ] Is there a way to collect qualitative feedback?

### 6. Assumption Check
- [ ] Have any unvalidated assumptions been proven wrong during development?
- [ ] If so, does the implementation need to change?

## Output

```markdown
## UX Validation Report

**Feature/PR**: [name]
**Date**: [YYYY-MM-DD]
**Discovery Doc**: [path to discovery doc]

### Alignment Score: [Strong | Partial | Weak | Misaligned]

### Findings
| Area | Status | Notes |
|------|--------|-------|
| Persona alignment | ✅/⚠️/❌ | [detail] |
| JTBD coverage | ✅/⚠️/❌ | [detail] |
| Journey gaps addressed | ✅/⚠️/❌ | [detail] |
| Design principles | ✅/⚠️/❌ | [detail] |
| Telemetry implemented | ✅/⚠️/❌ | [detail] |
| Assumptions valid | ✅/⚠️/❌ | [detail] |

### Recommendations
- [specific, actionable recommendations]

### Risks if Shipped As-Is
- [what could go wrong for users]
```

## Integration with Superpowers

If Superpowers' code-reviewer agent is active, the UX validation report should be
included alongside the code quality review. Technical quality AND user alignment
both matter.
