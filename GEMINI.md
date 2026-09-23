# spec-superflow v2.0.2 | opt-in

Use the bundled agent skills in `skills/` to run the spec-superflow workflow.

Start from `workflow-start` when a user wants to start, continue, resume, plan, implement, review, debug, close, or inspect a spec-superflow change.

The workflow is self-contained and does not require OpenSpec or Superpowers at runtime. It uses OpenSpec-style planning artifacts and Superpowers-style execution discipline with direct or planned execution; contracts are legacy compatibility only.


<!-- spec-superflow-phase-guard-start -->
Use workflow-start only for an explicit spec-superflow request or a request to continue an active change containing `.spec-superflow.yaml`. Otherwise this workflow adds no constraints.
<!-- spec-superflow-phase-guard-end -->
