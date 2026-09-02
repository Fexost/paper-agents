import { Injectable } from '@nestjs/common';

export type AgentStep = 'macro' | 'sector' | 'cio';
export type StepStatus = 'pending' | 'active' | 'done' | 'error';

export interface PipelineProgress {
  active: boolean;
  runId?: string;
  cycleNumber?: number;
  currentStep?: AgentStep | 'finalize';
  steps: Record<AgentStep, StepStatus>;
  error?: string;
  startedAt?: string;
}

@Injectable()
export class PipelineProgressService {
  private state: PipelineProgress = this.idleState();

  private idleState(): PipelineProgress {
    return {
      active: false,
      steps: { macro: 'pending', sector: 'pending', cio: 'pending' },
    };
  }

  getProgress(): PipelineProgress {
    return { ...this.state, steps: { ...this.state.steps } };
  }

  start(runId: string, cycleNumber?: number) {
    this.state = {
      active: true,
      runId,
      cycleNumber,
      currentStep: undefined,
      steps: { macro: 'pending', sector: 'pending', cio: 'pending' },
      startedAt: new Date().toISOString(),
    };
  }

  setStep(step: AgentStep | 'finalize', status: StepStatus) {
    if (!this.state.active) return;
    this.state.currentStep = step;
    if (step !== 'finalize') {
      this.state.steps[step] = status;
    }
  }

  completeStep(step: AgentStep) {
    if (!this.state.active) return;
    this.state.steps[step] = 'done';
  }

  complete() {
    this.state = this.idleState();
  }

  fail(message: string) {
    if (!this.state.active) return;
    const current = this.state.currentStep;
    if (current && current !== 'finalize') {
      this.state.steps[current] = 'error';
    }
    this.state.error = message;
    this.state.active = false;
  }
}
