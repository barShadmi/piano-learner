---
name: persona-builder
description: "Build me a persona for the primary user of this system, who are the users of this product, define the user types, let's flesh out the persona for the admin role, create a primary persona, I need to figure out our target users, what kind of person uses this tool, describe the typical developer who would adopt this — trigger this skill IMMEDIATELY whenever the user explicitly asks for personas, user types, target users, or wants to characterize \"who uses\" a product as a standalone artifact, even when they haven't used the word \"persona\" itself. Always invoke when the user names a role and asks to flesh it out, when they request a primary or secondary persona, when they ask to convert research findings into personas, or when research-intake has just produced behavioral patterns that now need to be shaped into named personas with goals, frustrations, and context of use. This skill produces behavioral (not demographic) personas with role and context, primary/emotional/ social goals, pain points, current workarounds, context of use, and evidence labeling — it is the destination artifact, not the orchestrator. Do NOT trigger for incidental mentions of \"users\" in UI copy or code, requests to read or display an existing persona document from disk, raw research data dumps without an explicit persona ask (research-intake owns that), or at the very start of a greenfield project where ux-discover should orchestrate. Prefer this skill over superpowers:brainstorming whenever the question is about WHO the users are rather than WHAT to build.\n"
version: '1.0.0'
---

# Persona Builder

Build personas that drive decisions, not decorate slide decks.

## Principles

- **Behavioral over demographic** — age/gender matter far less than behaviors, motivations, and context
- **Fewer is better** — 1-3 personas max. If you need more, your product scope is too broad.
- **Primary persona first** — one persona whose needs you prioritize above all others
- **Evidence-based** — every claim should trace to data or a stated assumption (clearly labeled)

## When Raw Data Is Available

If the user has provided interview transcripts, survey data, support tickets, analytics,
or feedback:

1. Read and analyze the data
2. Identify behavioral patterns and clusters
3. Propose persona groupings with evidence
4. Ask the user to validate groupings before fleshing out

## When Starting from Scratch

Ask these questions ONE AT A TIME:

1. "Who is the primary user of what you're building? Describe them by their **role and context**, not demographics."
   - Example good answer: "A backend engineer at a mid-size startup debugging production issues at 2am"
   - Example bad answer: "Males aged 25-35" (redirect if this happens)

2. "What does a typical day look like for this person, specifically around the problem you're solving?"

3. "What's their technical sophistication relative to your solution?"
   - Offer: Expert / Intermediate / Beginner / Mixed

4. "Are there other distinct user types who use this differently?"
   - If yes: repeat questions 1-3 for secondary personas (max 2 more)
   - If no: proceed

## Persona Template

For each persona, produce:

```markdown
### Persona: [Name — a memorable shorthand, not a real name]

**Role & Context**: [one sentence — who they are and where they operate]

**Behavioral Pattern**: [how they currently approach the problem space]

**Primary Goal**: [what they're trying to achieve — functional]
**Emotional Goal**: [how they want to feel — confident, in control, relieved, etc.]
**Social Goal**: [how they want to be perceived — competent, innovative, responsible, etc.]

**Frustrations & Pain Points**:
- [specific, observable frustrations — not vague]

**Current Tools & Workarounds**:
- [what they use today and how they hack around gaps]

**Context of Use**:
- **When**: [time pressure, frequency of use]
- **Where**: [environment — desk, mobile, terminal, meeting, etc.]
- **Device/Platform**: [relevant technical context]
- **Constraints**: [bandwidth, permissions, compliance, accessibility, etc.]

**Quote** (real or synthesized from data):
> "[A sentence that captures their mindset]"

**Priority**: [Primary | Secondary | Tertiary]
**Evidence basis**: [Data-backed | Assumption — validated by user | Assumption — needs validation]
```

## Validation

After presenting personas, ask:

> "Do these feel right? Is there anything that doesn't match your understanding of your users?"

Iterate based on feedback. Then confirm:

> "Which persona should we prioritize as the primary user? Their needs will take precedence when we face tradeoffs."

## Anti-Patterns to Avoid

- **The Everything Persona** — a persona that represents "everyone." Push back. Who is the PRIMARY user?
- **Demographic Stereotypes** — avoid assumptions based on age, gender, location unless evidence-based
- **Aspirational Personas** — personas should reflect WHO USERS ARE, not who the team wishes they were
- **Too Many Personas** — more than 3 means the scope needs narrowing, not more personas
