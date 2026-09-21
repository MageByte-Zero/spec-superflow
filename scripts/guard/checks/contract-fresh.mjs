import { readPlan, validatePlan } from '../../lib/execution-plan.mjs';
// scripts/guard/checks/contract-fresh.mjs — check planning and contract staleness
import { computeArtifactsHash, computeContractHash } from '../../lib/hash.mjs';
import { readState } from '../../lib/state-loader.mjs';

/**
 * Compare stored artifacts_hash in .spec-superflow.yaml against current artifact hashes.
 * Returns { pass, failures[] }.
 */
export function checkContractFresh(changeDir) {
  const plan = readPlan(changeDir);
  if (plan?.schema_version === 2) {
    const result = validatePlan(changeDir, plan);
    return { pass: result.valid, failures: result.failures };
  }
  const state = readState(changeDir);
  const failures = [];
  if (!state.artifacts_hash || state.artifacts_hash !== computeArtifactsHash(changeDir)) {
    failures.push('Planning artifacts changed after contract approval. Regenerate the contract and rebuild state.');
  }
  if (!state.contract_hash || state.contract_hash !== computeContractHash(changeDir)) {
    failures.push('execution-contract.md changed after approval. Review it again and rebuild state.');
  }
  return { pass: failures.length === 0, failures };
}
