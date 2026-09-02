import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { AgentStep, PipelineProgress, StepStatus } from '../../models';

@Component({
  selector: 'app-agent-pipeline-stepper',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="stepper" *ngIf="progress?.active">
      <div
        class="step"
        *ngFor="let step of steps; let i = index"
      >
        <span class="label" [ngClass]="stepStatus(step.key)">{{ step.label }}</span>
        <div class="dot-row">
          <span
            class="connector connector-left"
            *ngIf="i > 0"
            [class.done]="isDone(steps[i - 1].key)"
          ></span>
          <span class="dot" [ngClass]="stepStatus(step.key)"></span>
          <span
            class="connector connector-right"
            *ngIf="i < steps.length - 1"
            [class.done]="isDone(step.key)"
          ></span>
        </div>
      </div>
      <span class="elapsed" *ngIf="elapsed">{{ elapsed }}</span>
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        align-items: center;
        min-width: 0;
      }

      .stepper {
        display: flex;
        align-items: flex-end;
        gap: 0;
        padding: 0;
        border: none;
        background: transparent;
        min-width: 0;
      }

      .step {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.3rem;
        min-width: 72px;
      }

      .label {
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--muted);
      }

      .label.active {
        color: var(--accent);
      }

      .label.done {
        color: var(--good);
      }

      .label.error {
        color: var(--bad);
      }

      .dot-row {
        display: flex;
        align-items: center;
        width: 100%;
        justify-content: center;
      }

      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        border: 2px solid var(--border);
        background: transparent;
        flex-shrink: 0;
        position: relative;
        z-index: 1;
      }

      .dot.pending {
        border-color: var(--border);
        background: transparent;
      }

      .dot.active {
        border-color: var(--accent);
        background: var(--accent);
        box-shadow: 0 0 0 3px rgba(79, 124, 255, 0.25);
        animation: pulse 1.2s ease-in-out infinite;
      }

      .dot.done {
        border-color: var(--good);
        background: var(--good);
        box-shadow: none;
      }

      .dot.error {
        border-color: var(--bad);
        background: var(--bad);
      }

      .connector {
        height: 2px;
        flex: 1;
        background: var(--border);
        min-width: 12px;
      }

      .connector.done {
        background: var(--good);
      }

      .elapsed {
        margin-left: 0.75rem;
        padding-left: 0.75rem;
        border-left: 1px solid var(--border);
        font-size: 0.8rem;
        font-variant-numeric: tabular-nums;
        color: var(--muted);
        white-space: nowrap;
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.55;
        }
      }
    `,
  ],
})
export class AgentPipelineStepperComponent {
  @Input() progress: PipelineProgress | null = null;

  readonly steps = [
    { key: 'macro' as const, label: 'Macro' },
    { key: 'sector' as const, label: 'Sector' },
    { key: 'cio' as const, label: 'CIO' },
  ];

  stepStatus(key: AgentStep): StepStatus {
    return this.progress?.steps[key] ?? 'pending';
  }

  isDone(key: AgentStep): boolean {
    return this.progress?.steps[key] === 'done';
  }

  get elapsed(): string | null {
    if (!this.progress?.startedAt) return null;
    const ms = Date.now() - new Date(this.progress.startedAt).getTime();
    const sec = Math.floor(ms / 1000);
    const mm = Math.floor(sec / 60);
    const ss = sec % 60;
    return `${mm}:${ss.toString().padStart(2, '0')}`;
  }
}
