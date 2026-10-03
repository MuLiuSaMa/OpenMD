import { useTranslation } from "react-i18next";

interface StepIndicatorProps {
  currentStep: number;
}

const steps = [
  "step_welcome",
  "step_license",
  "step_directory",
  "step_install",
  "step_finish",
] as const;

export default function StepIndicator({ currentStep }: StepIndicatorProps) {
  const { t } = useTranslation();

  return (
    <div>
      {steps.map((stepKey, index) => {
        const stepNum = index + 1;
        const isActive = currentStep === stepNum;
        const isDone = currentStep > stepNum;

        return (
          <div key={stepKey} className={`step-item ${isActive ? "active" : ""} ${isDone ? "done" : ""}`}>
            <div className="step-number">
              {isDone ? "✓" : stepNum}
            </div>
            <div className="step-label">{t(stepKey)}</div>
          </div>
        );
      })}
    </div>
  );
}
