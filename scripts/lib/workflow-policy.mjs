import { loadConfig } from './config-loader.mjs';
// Shared interpretation of workflow evidence for guards, recovery and injection.
import { readState } from './state-loader.mjs';
import { isDirectWorkflowReceipt, readWorkflowSelection } from './workflow-recommendation.mjs';

export function workflowPolicy(changeDir, state = readState(changeDir)) {
  const receipt = readWorkflowSelection(changeDir);
  const directShortPath = receipt.valid && isDirectWorkflowReceipt(receipt.record, state);
  const missingDebugReceipt = state.state === 'debugging'
    && ['tweak', 'quick', 'lightweight'].includes(state.workflow)
    && !readPlanlessDebugReceipt(changeDir, state);
  return {
    directShortPath,
    requiresExecutionPlan: !['tweak', 'quick', 'lightweight'].includes(state.workflow) && !directShortPath,
    missingDirectReceipt: (['quick', 'lightweight'].includes(state.workflow) && !directShortPath)
      || missingDebugReceipt,
    missingDebugReceipt,
  };
}

export function readPlanlessDebugReceipt(changeDir, state) {
  const loaded = readWorkflowSelection(changeDir);
  if (!loaded.valid) return null;
  if (isDirectWorkflowReceipt(loaded.record, state)) return loaded.record;

  const selection = loaded.record?.selection;
  const validTweak = state.workflow === 'tweak'
    && loaded.record?.status === 'ready'
    && loaded.record?.recommendation?.mode === 'tweak'
    && selection?.mode === 'tweak'
    && selection.accepted_automatically === false
    && selection.followed_recommendation === true
    && typeof selection.confirmed_at === 'string'
    && Number.isFinite(Date.parse(selection.confirmed_at));
  return validTweak ? loaded.record : null;
}


export function artifactPolicy(changeDir) {
  const skip = loadConfig(changeDir).artifacts?.skip ?? [];
  return { skip, requireSpecs: !skip.includes('specs'),
    failures: skip.includes('tasks') ? ['Full planning cannot skip tasks; use a lightweight workflow instead'] : [] };
}
