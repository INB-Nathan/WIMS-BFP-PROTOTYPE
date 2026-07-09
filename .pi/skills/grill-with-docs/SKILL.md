---
name: grill-with-docs
description: A relentless interview to sharpen a plan or design, which also creates docs (ADRs and glossary) as we go. Use when you have a fuzzy requirement, need to stress-test a design before building, or want domain terms pinned into CONTEXT.md and decisions recorded as ADRs.
---

# Grill With Docs

This skill merges the **brainstorming arc** (explore → grill → approaches → design → doc → review → implement) with Matt Pocock's **grill-with-docs** approach: a relentless, one-question-at-a-time interview that writes vocabulary and decisions down the moment they crystallise.

The engine is a **grill**: a structured walk down the design tree, resolving dependencies between decisions before moving on, with a recommended answer offered for every question.

The discipline is **domain-modeling**: terms get sharpened into canonical glossary entries (`CONTEXT.md`) as they resolve, and hard-to-reverse decisions get recorded as ADRs (`system-wiki/decisions/`) — sparingly, only when the decision is genuinely structural.

<HARD-GATE>
Do NOT invoke any implementation skill, write any code, scaffold any project, or take any implementation action until you have presented a design and the user has approved it. This applies to EVERY project regardless of perceived simplicity.
</HARD-GATE>

---

## Anti-Patterns

**"This is too simple to need a design."**
Every project goes through this process — a todo list, a single-function utility, a config change. "Simple" projects are where unexamined assumptions cause the most wasted work. The design can be a few sentences, but you MUST present it and get approval.

**"Let me batch all the questions and answers later."**
No. Resolved terms go into CONTEXT.md right there, not at the end. Decisions get recorded when they crystallise. Don't batch — capture inline.

---

## Checklist

Complete in order:

1. **Explore project context** — check files, docs, recent commits
2. **Offer the visual companion just-in-time** — only when a question would genuinely be clearer shown (mockups, diagrams, layouts). Offer it as its own message. See Visual Companion section below.
3. **The Grill** — walk the design tree, one question at a time, with recommended answers, codebase exploration, and domain-modeling discipline running beneath
4. **Propose 2–3 approaches** — with trade-offs and your recommendation
5. **Present design** — in sections scaled to complexity, get user approval after each section
6. **Write docs** — design spec to `docs/superpowers/specs/`, glossary and ADRs already captured inline
7. **Spec self-review** — check for placeholder, contradiction, ambiguity, scope
8. **User reviews written spec** — ask the user to review before proceeding
9. **Transition to implementation** — invoke `/issue-implement` with the issue number

---

## The Grill

This replaces the "ask clarifying questions" step. It is deeper, more structured, and writes as it goes.

### Walk the design tree

Every plan branches into decisions, and decisions depend on each other. Descend that tree one node at a time:

- Start broad: "What problem are we solving, and for whom?"
- Then branch: each answer shapes which questions come next
- Resolve dependencies between decisions before moving sideways

**One question per message.** Asking multiple questions at once is bewildering — the tree structure collapses and you lose the dependency ordering.

**Include your recommended answer** for every question. The user should be able to agree, disagree, or refine — not start from blank.

**Explore the codebase instead of asking.** If a question can be answered by reading code, docs, config, recent commits, or log output, do that and report what you found rather than asking.

### Know when to stop the grill

You don't need to grill everything — only until you and the user share the same understanding and can proceed to proposing approaches. Signs you're done:

- The key terms are settled and in CONTEXT.md
- The scope is clear (what's in, what's out)
- The constraints are known
- Risk areas are surfaced

If the project is too large for a single spec (multiple independent subsystems), flag this and help the user decompose before the grill runs deep on one piece.

---

## Domain-modeling discipline

This runs **beneath** the grill and the design phases — it fires the moment a term or decision crystallises.

### Files

| File | Purpose | Created |
|------|---------|---------|
| `CONTEXT.md` (repo root) | Glossary — pure vocabulary, no implementation details | Already exists. Update it when terms are resolved. |
| `system-wiki/decisions/` | Architecture Decision Records | Lazily, when first hard decision is made |

If a `CONTEXT-MAP.md` exists at the root, follow it for multi-context repos. Otherwise use a single `CONTEXT.md`.

### During the grill: challenge and capture

**Challenge against existing language.** When the user uses a term that conflicts with the glossary, call it out immediately: "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

**Sharpen fuzzy language.** When the user uses vague or overloaded terms, propose a precise canonical term: "You're saying 'report' — do you mean the Citizen Report (staging) or the Fire Incident (official AFOR)? Those are different entities."

**Stress-test with concrete scenarios.** When domain relationships are being discussed, invent scenarios that probe edge cases and force the user to be precise.

**Cross-reference with code.** When the user states how something works, check whether the code agrees. Surface contradictions: "Your code cancels entire Incidents, but you just said partial cancellation is possible — which is right?"

**Update CONTEXT.md inline.** When a term is resolved, update CONTEXT.md right there. Capture format:

```md
**CanonicalTerm**:
A one or two sentence definition of the term.
_Avoid_: Fuzzy alias 1, fuzzy alias 2
```

Keep definitions tight — one or two sentences. Only project-specific concepts belong. General programming concepts (timeouts, error types) do not.

### Offer ADRs sparingly

Only offer to create an ADR when **all three** are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Most grill sessions produce a sharper glossary and zero or one ADRs — that's the intended shape.

ADR format (create `system-wiki/decisions/NNNN-slug.md`):

```md
# {Short title}

{1–3 sentences: what's the context, what did we decide, and why.}
```

Optional sections (only when they add genuine value): Status frontmatter, Considered Options, Consequences.

---

## Proposing approaches

After the grill has established shared understanding:

- Propose 2–3 different approaches with trade-offs
- Lead with your recommended option and explain why
- Stay conversational — this is a discussion, not a specification

---

## Presenting the design

Once approaches are settled:

- Scale each section to its complexity: a few sentences if straightforward, up to 200–300 words if nuanced
- Ask after each section whether it looks right
- Cover: architecture, components, data flow, error handling, testing
- Follow existing codebase patterns
- Where existing code has problems that affect the work, include targeted improvements — don't propose unrelated refactoring

**Design for isolation and clarity:** Break the system into smaller units with one clear purpose, communicating through well-defined interfaces. Can someone understand what a unit does without reading its internals? Can you change the internals without breaking consumers?

---

## After the design

### Write the spec

Save the validated design to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.

The spec captures the *design* — the glossary and ADRs are already in `CONTEXT.md` and `system-wiki/decisions/`. Don't duplicate them in the spec.

Commit the design doc.

### Spec self-review

Check for:
1. **Placeholders** — any "TBD", "TODO", incomplete sections?
2. **Internal consistency** — do sections contradict each other?
3. **Scope creep** — is this focused enough for a single implementation?
4. **Ambiguity** — could any requirement be interpreted two different ways?

Fix inline, no need to re-review.

### User review gate

> "Spec written and committed to `<path>`. Please review it and let me know if you want to make any changes before we start writing out the implementation plan."

Wait for the user. If they request changes, make them and re-run the self-review.

### Transition to implementation

Invoke `/issue-implement` with the GitHub issue number. Create the issue first if needed (with acceptance criteria and `ready-for-agent` label). Do NOT invoke any other skill — `/issue-implement` is the next step.

---

## Key Principles

- **One question at a time** — never dump a list
- **Recommend, don't ask blank** — every question includes your recommended answer
- **Explore before asking** — read code, docs, commits instead of interrogating the user
- **Capture inline** — terms → CONTEXT.md the moment they resolve
- **ADRs are rare** — hard to reverse + surprising + genuine trade-off, all three
- **YAGNI ruthlessly** — remove unnecessary features from all designs
- **Incremental validation** — present design sections, get approval before moving on

---

## Visual Companion

A browser-based companion for showing mockups, diagrams, and visual options. See the Visual Companion section in the global `brainstorming` skill for detailed instructions (`~/.pi/agent/skills/brainstorming/SKILL.md`).

---

## Reference files

- **ADR format**: `.pi/skills/grill-with-docs/references/adr-format.md` (bundled)
- **CONTEXT format**: `.pi/skills/grill-with-docs/references/context-format.md` (bundled)
