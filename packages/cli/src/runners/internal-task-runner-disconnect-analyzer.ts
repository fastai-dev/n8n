import { TaskRunnersConfig } from '@n8n/config';
import { Service } from 'typedi';

import config from '@/config';

import { DefaultTaskRunnerDisconnectAnalyzer } from './default-task-runner-disconnect-analyzer';
import { TaskRunnerOomError } from './errors/task-runner-oom-error';
import { SlidingWindowSignal } from './sliding-window-signal';
import type { TaskRunner } from './task-broker.service';
import type { ExitReason, TaskRunnerProcessEventMap } from './task-runner-process';
import { TaskRunnerProcess } from './task-runner-process';

/**
 * Analyzes the disconnect reason of a task runner process to provide a more
 * meaningful error message to the user.
 */
@Service()
export class InternalTaskRunnerDisconnectAnalyzer extends DefaultTaskRunnerDisconnectAnalyzer {
	private get isCloudDeployment() {
		return config.get('deployment.type') === 'cloud';
	}

	private readonly exitReasonSignal: SlidingWindowSignal<TaskRunnerProcessEventMap, 'exit'>;

	constructor(
		private readonly runnerConfig: TaskRunnersConfig,
		private readonly taskRunnerProcess: TaskRunnerProcess,
	) {
		super();

		// When the task runner process is running as a child process, there's
		// no determinate time when it exits compared to when the runner disconnects
		// (i.e. it's a race condition). Hence we use a sliding window to determine
		// the exit reason. As long as we receive the exit signal from the task
		// runner process within the window, we can determine the exit reason.
		this.exitReasonSignal = new SlidingWindowSignal(this.taskRunnerProcess, 'exit', {
			windowSizeInMs: 500,
		});
	}

	async determineDisconnectReason(runnerId: TaskRunner['id']): Promise<Error> {
		const exitCode = await this.awaitExitSignal();
		if (exitCode === 'oom') {
			return new TaskRunnerOomError(runnerId, this.isCloudDeployment);
		}

		return await super.determineDisconnectReason(runnerId);
	}

	private async awaitExitSignal(): Promise<ExitReason> {
		if (this.runnerConfig.mode === 'external') {
			// If the task runner is running in external mode, we don't have
			// control over the process and hence cannot determine the exit
			// reason. We just return 'unknown' in this case.
			return 'unknown';
		}

		const lastExitReason = await this.exitReasonSignal.getSignal();

		return lastExitReason?.reason ?? 'unknown';
	}
}