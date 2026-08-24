export function WorkflowRail({
  steps,
}: {
  steps: Array<{ label: string; detail: string }>;
}) {
  return (
    <section className="ec-workflow-rail" aria-label="Operational workflow">
      {steps.map((step, index) => (
        <div className="ec-workflow-step" key={step.label}>
          <span className="ec-workflow-index" aria-hidden="true">
            {index + 1}
          </span>
          <span className="ec-workflow-copy">
            <strong>{step.label}</strong>
            <small>{step.detail}</small>
          </span>
        </div>
      ))}
    </section>
  );
}
