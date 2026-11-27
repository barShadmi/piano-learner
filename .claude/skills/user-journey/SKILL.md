---
name: user-journey
description: "Use when mapping the end-to-end user experience for any software product, including CLI tools, APIs, SDKs, infrastructure, and other non-visual interfaces that most journey-mapping approaches skip. Trigger IMMEDIATELY whenever the user says \"map the user journey\", \"create a journey map\", \"current-state experience\", \"desired-state experience\", \"end-to-end user flow\", \"moment-by-moment experience\", \"trace the user's path\", \"walk me through the [API/CLI/SDK] experience\", \"how does an SRE actually use\", \"where are the pain points\", or asks about touchpoints, user emotions, friction, or moments of truth across a workflow. Always invoke when someone wants to understand what users think, feel, and do BEFORE, DURING, and AFTER touching a product — even if the product has no GUI, because this skill explicitly handles terminal commands, API integration steps, documentation lookups, Slack conversations, error recovery, and other non-visual touchpoints that generic journey tools ignore. Produces both current-state and desired-state maps plus gap analysis. Differentiate from persona-builder (who the user is), jobs-to-be-done (what they're trying to accomplish), telemetry-designer (how to measure), and ux-validate (which checks built code against an existing journey rather than creating one). Do NOT trigger for code execution flow, call graphs, test scenarios, CI/CD pipeline traces, debugging stack traces, or any \"journey\" that has no human user, and skip when ux-discover is already orchestrating.\n"
version: '1.0.0'
---

# User Journey Mapping

Map the full experience, not just the interface. Journeys include what happens
BEFORE, DURING, and AFTER using your software.

## Adapting to Software Type

Journey maps look different depending on what you're building:

- **Web/Mobile App**: Visual touchpoints, screens, interactions
- **CLI Tool**: Commands, flags, output parsing, error recovery
- **API/SDK**: Integration steps, documentation, debugging, deployment
- **Infrastructure**: Setup, configuration, monitoring, incident response
- **Internal Tool**: Discovery, onboarding, daily workflow, edge cases

Always ask what type of software is being built and adapt the journey format accordingly.

## Process

### Step 1: Define the Scenario

Using personas and JTBD from prior phases, ask:

> "Let's map the journey for [primary persona] trying to [primary job]. What's the
> starting trigger — what makes them begin this process?"

### Step 2: Map Current State

Walk through the experience step by step. For each phase, capture:

```markdown
## Current-State Journey: [Persona] — [Job]

### Phase: [Name]
- **Action**: What the user does
- **Touchpoint**: Where/how they interact (screen, terminal, docs, Slack, etc.)
- **Thinking**: What's going through their mind
- **Feeling**: Emotional state (use: confident, frustrated, confused, anxious, neutral, satisfied, delighted)
- **Pain Points**: What's broken or friction-heavy
- **Duration**: How long this phase takes
```

Guide the user through each phase conversationally. Don't present a blank template — 
ask them to walk you through it like they're narrating a user's day.

Suggested phases (adapt to context):
1. **Awareness** — how they discover the need
2. **Evaluation** — how they assess options
3. **Onboarding** — first-time setup/use
4. **Core Usage** — the primary workflow
5. **Problem/Edge Case** — when things go wrong
6. **Resolution** — how they recover or get help
7. **Return/Habit** — what brings them back

### Step 3: Identify Moments of Truth

After mapping the current state, highlight:

```markdown
## Moments of Truth

### Make-or-Break Moments
- [moments where users decide to continue or abandon]

### Peak Pain Points
- [highest-friction points in the journey]

### Moments of Delight (if any exist today)
- [things that currently work well — preserve these]
```

### Step 4: Map Desired State

For each phase where pain points exist, ask:

> "In an ideal experience, what would [phase name] look like instead?"

Produce a desired-state journey that shows the improved flow:

```markdown
## Desired-State Journey: [Persona] — [Job]

### Phase: [Name]
- **Action**: What the user does (simplified/improved)
- **Touchpoint**: Where/how they interact (new or changed)
- **Thinking**: What's going through their mind (less confusion, more confidence)
- **Feeling**: Target emotional state
- **Design Opportunity**: What we build to enable this improvement
- **Metric**: How we'll know this phase is working
```

### Step 5: Gap Analysis

```markdown
## Journey Gap Analysis

| Phase | Current State | Desired State | Gap | Priority |
|-------|---------------|---------------|-----|----------|
| [phase] | [summary] | [summary] | [what needs to change] | [High/Med/Low] |
```

## Output

The journey map should be saved as part of the UX Discovery Document.
Include both current-state and desired-state maps, moments of truth,
and the gap analysis with priorities.

## Rules

- **Walk the journey, don't template it** — have a conversation, not a form fill
- **Include non-product touchpoints** — Slack messages, Googling errors, asking teammates
- **Emotional states matter** — they predict adoption and retention
- **Time matters** — if a phase takes 3 hours, that's critical context
- **Edge cases are journeys too** — map the error/failure path, not just the happy path
