import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AgentStep, PipelineProgress, StepStatus } from '../../models';

@Component({
  selector: 'app-agent-pipeline-stepper',
  standalone: true,
  templateUrl: './agent-pipeline-stepper.component.html',
  styleUrl: './agent-pipeline-stepper.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentPipelineStepperComponent {
  readonly progress = input<PipelineProgress | null>(null);

  protected readonly steps = [
    { key: 'macro' as const, label: 'Macro' },
    { key: 'sector' as const, label: 'Sector' },
    { key: 'cio' as const, label: 'CIO' },
  ];

  protected stepStatus(key: AgentStep): StepStatus {
    return this.progress()?.steps[key] ?? 'pending';
  }

  protected isDone(key: AgentStep): boolean {
    return this.progress()?.steps[key] === 'done';
  }

  protected get elapsed(): string | null {
    const startedAt = this.progress()?.startedAt;
    if (!startedAt) return null;
    const ms = Date.now() - new Date(startedAt).getTime();
    const sec = Math.floor(ms / 1000);
    const mm = Math.floor(sec / 60);
    const ss = sec % 60;
    return `${mm}:${ss.toString().padStart(2, '0')}`;
  }
}
